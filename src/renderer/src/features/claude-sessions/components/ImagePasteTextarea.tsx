import {
	useEffect,
	useRef,
	useState,
	type ClipboardEvent,
	type KeyboardEvent,
} from "react";
import type {
	SessionMode,
	UserContentBlock,
	UserImageMediaType,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { T } from "../../../design/tokens";
import { Kbd, ModeToggle } from "../../../design/Atoms";

interface Props {
	sessionId: string;
	disabled?: boolean;
	textareaHeight?: number;
}

interface PendingImage {
	media_type: UserImageMediaType;
	data: string;
	previewUrl: string;
}

const SUPPORTED_IMAGE_TYPES: readonly UserImageMediaType[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

function toSupportedMediaType(t: string): UserImageMediaType | null {
	return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t)
		? (t as UserImageMediaType)
		: null;
}

export function ImagePasteTextarea({ sessionId, disabled, textareaHeight = 44 }: Props) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<PendingImage[]>([]);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [modeSwitching, setModeSwitching] = useState(false);
	// Subscribe to mode so the toggle reflects live SDK / IPC updates (e.g.
	// `session:patch` broadcasts after a successful setMode in the main process).
	const mode = useSessionsStore(
		(s) => s.sessions[sessionId]?.mode ?? "plan",
	);
	const status = useSessionsStore((s) => s.sessions[sessionId]?.status);
	const isRunning = status === "running";

	// Auto-focus the textarea on session entry / switch. Keyed on sessionId
	// so the focus also fires when navigating between sessions, not just the
	// initial mount. The setTimeout(…, 0) defers focus past the same tick as
	// any route transition / layout work so the call lands on the real DOM
	// node after it has been (re)mounted.
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const id = window.setTimeout(() => {
			textareaRef.current?.focus();
		}, 0);
		return () => window.clearTimeout(id);
	}, [sessionId]);

	const changeMode = async (next: SessionMode) => {
		if (modeSwitching || mode === next) return;
		// Optimistic flip; revert on IPC failure. The main process broadcasts
		// the canonical value back via session:patch on success.
		useSessionsStore.getState().upsertSession({ id: sessionId, mode: next });
		setModeSwitching(true);
		try {
			await window.claude.setSessionMode(sessionId, next);
		} catch (err) {
			useSessionsStore
				.getState()
				.upsertSession({ id: sessionId, mode });
			console.error("Failed to change session mode", err);
		} finally {
			setModeSwitching(false);
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = Array.from(e.clipboardData.items);
		const imageItems = items.filter((it) => it.type.startsWith("image/"));
		if (imageItems.length === 0) return;
		e.preventDefault();
		for (const item of imageItems) {
			const file = item.getAsFile();
			if (!file) continue;
			const mediaType = toSupportedMediaType(file.type);
			if (!mediaType) {
				setError(`Unsupported image type: ${file.type}`);
				continue;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result as string;
				const data = dataUrl.split(",")[1] ?? "";
				setImages((prev) => [
					...prev,
					{ media_type: mediaType, data, previewUrl: dataUrl },
				]);
			};
			reader.readAsDataURL(file);
		}
	};

	const removeImage = (idx: number) =>
		setImages((prev) => prev.filter((_, i) => i !== idx));

	const send = async () => {
		if (sending) return;
		if (!text.trim() && images.length === 0) return;
		const blocks: UserContentBlock[] = [];
		for (const img of images) {
			blocks.push({
				type: "image",
				source: {
					type: "base64",
					media_type: img.media_type,
					data: img.data,
				},
			});
		}
		if (text.trim()) blocks.push({ type: "text", text: text.trim() });

		setSending(true);
		setError(null);
		try {
			const sess = useSessionsStore.getState().sessions[sessionId];
			const isOpen =
				sess?.status === "running" ||
				sess?.status === "idle" ||
				sess?.status === "awaiting_permission";
			if (!isOpen && sess?.sdkSessionId) {
				await window.claude.resumeSession(sessionId);
			}
			await window.claude.sendUserMessage({ sessionId, blocks });
			useSessionsStore.getState().appendMessage(sessionId, {
				id: crypto.randomUUID(),
				role: "user",
				content: {
					type: "user",
					message: { role: "user", content: blocks },
				},
				ts: Date.now(),
			});
			setText("");
			setImages([]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			void send();
		}
	};

	const canSend = !!(text.trim() || images.length > 0);

	return (
		<div
			style={{
				flexShrink: 0,
				padding: "14px 32px 18px",
				background: T.win,
			}}
		>
			<div
				style={{
					maxWidth: 760,
					margin: "0 auto",
					borderRadius: 12,
					border: `0.5px solid ${T.border}`,
					background: T.surface,
					padding: 12,
					boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
				}}
			>
				{images.length > 0 ? (
					<div
						style={{
							display: "flex",
							gap: 6,
							flexWrap: "wrap",
							marginBottom: 10,
						}}
					>
						{images.map((img, i) => (
							<div key={i} style={{ position: "relative" }}>
								<img
									src={img.previewUrl}
									alt=""
									style={{
										height: 64,
										width: 64,
										objectFit: "cover",
										borderRadius: 6,
										border: `0.5px solid ${T.border}`,
									}}
								/>
								<button
									onClick={() => removeImage(i)}
									title="Remove"
									style={{
										position: "absolute",
										top: -6,
										right: -6,
										width: 20,
										height: 20,
										borderRadius: "50%",
										border: "none",
										background: T.text,
										color: T.bg,
										fontSize: 12,
										cursor: "pointer",
										lineHeight: 1,
									}}
								>
									×
								</button>
							</div>
						))}
					</div>
				) : null}

				{error ? (
					<div
						className="message message-error"
						style={{
							padding: 8,
							fontSize: 12,
							marginBottom: 10,
							textAlign: "left",
						}}
					>
						{error}
					</div>
				) : null}

				<textarea
					ref={textareaRef}
					autoFocus
					value={text}
					onChange={(e) => setText(e.target.value)}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					disabled={disabled || sending}
					placeholder="Reply to Claude…"
					style={{
						width: "100%",
						height: textareaHeight,
						resize: "none",
						background: "transparent",
						border: "none",
						outline: "none",
						color: T.text,
						fontFamily: T.sans,
						fontSize: 14,
						lineHeight: 1.5,
						padding: 0,
						overflowY: "auto",
					}}
				/>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginTop: 10,
						paddingTop: 10,
						borderTop: `0.5px solid ${T.borderSoft}`,
					}}
				>
					<span
						style={{
							fontSize: 11.5,
							color: T.textFaint,
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<Kbd>↵</Kbd>
						<span>to send ·</span>
						<Kbd>⇧</Kbd>
						<Kbd>↵</Kbd>
						<span>for newline · paste images directly</span>
					</span>
					<div style={{ flex: 1 }} />
					<ModeToggle
						mode={mode}
						onChange={(next) => void changeMode(next)}
						disabled={modeSwitching}
					/>
					<button
						onClick={send}
						disabled={disabled || sending || !canSend}
						className="btn btn-primary"
						style={isRunning ? { opacity: 0.55, cursor: "default" } : undefined}
					>
						{sending ? "…" : "Send"}
						{!sending ? (
							<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
								<path
									d="M2 6h8M7 3l3 3-3 3"
									stroke="currentColor"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						) : null}
					</button>
				</div>
			</div>
		</div>
	);
}
