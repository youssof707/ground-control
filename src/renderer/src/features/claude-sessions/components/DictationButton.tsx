import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { T } from "../../../design/tokens";

/**
 * On-device voice dictation button. Click to record, click again to stop —
 * raw 16 kHz mono PCM is captured directly off the mic stream (no
 * MediaRecorder / no lossy re-decode) and transcribed by whisper.cpp in the
 * main process. Nothing leaves the machine.
 *
 * First use triggers a one-time ~148 MB model download (progress shown in
 * the button).
 */

type DictationState =
	| "idle"
	| "starting"
	| "downloading"
	| "recording"
	| "transcribing";

export interface DictationHandle {
	/**
	 * If a recording is in progress, stop it and kick off transcription.
	 * Returns true when a recording was committed (callers should then
	 * swallow the triggering event, e.g. Enter-to-send).
	 */
	commitIfRecording: () => boolean;
}

interface Props {
	disabled?: boolean;
	/** Called with the transcript; owner handles caret-aware insertion. */
	onInsert: (text: string) => void;
	/** Surfaces failures in the composer's existing error block. */
	onError: (msg: string) => void;
	/** Lets the composer adapt its keyboard hint while recording. */
	onRecordingChange?: (recording: boolean) => void;
	ref?: Ref<DictationHandle>;
}

const SAMPLE_RATE = 16_000;
const MAX_RECORD_MS = 5 * 60_000;
/** Whisper rejects sub-second clips; treat them as accidental clicks. */
const MIN_SECONDS = 0.5;

export function DictationButton({
	disabled,
	onInsert,
	onError,
	onRecordingChange,
	ref,
}: Props) {
	const [state, setState] = useState<DictationState>("idle");
	// Mirror for imperative callers (keyboard handlers) that need the
	// current state outside the render cycle.
	const stateRef = useRef<DictationState>("idle");
	stateRef.current = state;
	const [downloadPct, setDownloadPct] = useState(0);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const processorRef = useRef<ScriptProcessorNode | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Float32Array[]>([]);
	const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			cleanupCapture();
		};
	}, []);

	const cleanupCapture = () => {
		if (maxTimerRef.current) {
			clearTimeout(maxTimerRef.current);
			maxTimerRef.current = null;
		}
		processorRef.current?.disconnect();
		processorRef.current = null;
		void audioCtxRef.current?.close().catch(() => undefined);
		audioCtxRef.current = null;
		streamRef.current?.getTracks().forEach((t) => t.stop());
		streamRef.current = null;
		chunksRef.current = [];
	};

	const setStateSafe = (next: DictationState) => {
		if (!mountedRef.current) return;
		if ((stateRef.current === "recording") !== (next === "recording")) {
			onRecordingChange?.(next === "recording");
		}
		stateRef.current = next;
		setState(next);
	};

	const ensureModel = async (): Promise<void> => {
		setStateSafe("downloading");
		setDownloadPct(0);
		const off = window.claude.on("dictation:downloadProgress", (p) => {
			const { percent } = p as { percent: number };
			if (mountedRef.current) setDownloadPct(percent);
		});
		try {
			await window.claude.downloadDictationModel();
		} finally {
			off();
		}
	};

	const startRecording = async (): Promise<void> => {
		// Immediate visual feedback — permission checks + mic init can take a
		// beat, especially on first use.
		setStateSafe("starting");
		try {
			const [granted, { state: modelState }] = await Promise.all([
				window.claude.requestMicAccess(),
				window.claude.dictationModelStatus(),
			]);
			if (!granted) {
				setStateSafe("idle");
				onError(
					"Microphone access denied — enable it in System Settings → Privacy & Security → Microphone.",
				);
				return;
			}
			if (modelState !== "ready") await ensureModel();

			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1 },
			});
			streamRef.current = stream;
			chunksRef.current = [];

			// Capture raw PCM at whisper's 16 kHz directly — Chromium resamples
			// the mic stream to the context rate for us. The processor's output
			// stays silent (we never write to it), so no feedback loop.
			const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
			audioCtxRef.current = ctx;
			const source = ctx.createMediaStreamSource(stream);
			const processor = ctx.createScriptProcessor(4096, 1, 1);
			processor.onaudioprocess = (e) => {
				chunksRef.current.push(
					new Float32Array(e.inputBuffer.getChannelData(0)),
				);
			};
			processorRef.current = processor;
			source.connect(processor);
			processor.connect(ctx.destination);

			setStateSafe("recording");
			maxTimerRef.current = setTimeout(() => {
				void stopAndTranscribe();
			}, MAX_RECORD_MS);
		} catch (err) {
			cleanupCapture();
			setStateSafe("idle");
			onError(err instanceof Error ? err.message : String(err));
		}
	};

	const stopAndTranscribe = async (): Promise<void> => {
		if (!audioCtxRef.current) return;
		setStateSafe("transcribing");
		try {
			// Grab the captured samples BEFORE cleanup clears the chunk list.
			const chunks = chunksRef.current;
			chunksRef.current = [];
			cleanupCapture();

			const total = chunks.reduce((n, c) => n + c.length, 0);
			if (total < SAMPLE_RATE * MIN_SECONDS) {
				setStateSafe("idle");
				return;
			}
			const pcm = new Float32Array(total);
			let offset = 0;
			for (const c of chunks) {
				pcm.set(c, offset);
				offset += c.length;
			}

			const text = await window.claude.transcribeDictation(pcm);
			if (text) onInsert(text);
			setStateSafe("idle");
		} catch (err) {
			cleanupCapture();
			setStateSafe("idle");
			onError(err instanceof Error ? err.message : String(err));
		}
	};

	const onClick = () => {
		if (state === "idle") void startRecording();
		else if (state === "recording") void stopAndTranscribe();
	};

	useImperativeHandle(ref, () => ({
		commitIfRecording: () => {
			if (stateRef.current !== "recording") return false;
			void stopAndTranscribe();
			return true;
		},
	}));

	const busy =
		state === "starting" || state === "downloading" || state === "transcribing";
	const title =
		state === "recording"
			? "Stop dictation"
			: state === "starting"
				? "Starting microphone…"
				: state === "downloading"
					? `Downloading speech model… ${downloadPct}%`
					: state === "transcribing"
						? "Transcribing…"
						: "Dictate (on-device — first use downloads a 148 MB model)";

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled || busy}
			aria-label={title}
			className={`btn btn-icon${state === "recording" ? " dictation-recording" : ""}`}
			style={busy ? { cursor: "default" } : undefined}
		>
			{state === "downloading" ? (
				<span style={{ fontSize: 9, color: T.textDim }}>{downloadPct}%</span>
			) : busy ? (
				<span
					className="asyncy-btn-spinner"
					style={{ width: 12, height: 12 }}
				/>
			) : (
				<svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
					<rect
						x="4.5"
						y="0.9"
						width="3"
						height="5.4"
						rx="1.5"
						stroke="currentColor"
						strokeWidth="1.3"
					/>
					<path
						d="M2.7 5.4a3.3 3.3 0 0 0 6.6 0"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
					/>
					<path
						d="M6 8.7v1.5M4.3 10.9h3.4"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
					/>
				</svg>
			)}
		</button>
	);
}
