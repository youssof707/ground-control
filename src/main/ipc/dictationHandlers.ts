import { app, ipcMain, net, systemPreferences } from "electron";
import { createWriteStream, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { broadcast } from "../windows";

/**
 * On-device voice dictation via whisper.cpp (@kutalia/whisper-node-addon).
 *
 * Privacy invariant: audio and transcripts NEVER leave this machine. The only
 * network activity in this module is the one-time download of the ggml model
 * weights from Hugging Face (inbound only).
 *
 * Note: we load the prebuilt `whisper.node` directly instead of going through
 * the package's JS wrapper — the wrapper resolves `dist/darwin-arm64/` but the
 * package actually ships `dist/mac-arm64/`. The binary's rpath is fixed up by
 * `scripts/fix-whisper-rpath.mjs` (postinstall) so it can find its dylibs.
 */

const MODEL_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
/** Approximate size of ggml-base.en.bin; used for progress + sanity checks. */
const MODEL_BYTES = 147_951_465;
/** "ggml" magic in little-endian as the first 4 bytes of the model file. */
const GGML_MAGIC = 0x67676d6c;

type ModelState = "ready" | "absent" | "downloading";

/** Rows are [startTimestamp, endTimestamp, text]. */
interface WhisperResult {
	transcription: Array<[string, string, string]>;
}

type WhisperFn = (params: Record<string, unknown>) => Promise<WhisperResult>;

const nodeRequire = createRequire(import.meta.url);
let whisperFn: WhisperFn | null = null;
let downloading = false;
/** Serialize transcriptions — the native addon is not re-entrant. */
let transcribeChain: Promise<unknown> = Promise.resolve();

function getWhisper(): WhisperFn {
	if (!whisperFn) {
		const pkgDir = dirname(
			nodeRequire.resolve("@kutalia/whisper-node-addon/package.json"),
		);
		const addonPath = join(pkgDir, "dist", `mac-${process.arch}`, "whisper.node");
		const { whisper } = nodeRequire(addonPath) as {
			whisper: (params: unknown, cb: (err: unknown, res: WhisperResult) => void) => void;
		};
		whisperFn = promisify(whisper) as unknown as WhisperFn;
	}
	return whisperFn;
}

function modelPath(): string {
	return join(app.getPath("userData"), "models", "ggml-base.en.bin");
}

async function modelState(): Promise<ModelState> {
	if (downloading) return "downloading";
	try {
		const stat = await fs.stat(modelPath());
		// Guard against truncated files from a previous crash mid-download.
		return stat.size > MODEL_BYTES * 0.9 ? "ready" : "absent";
	} catch {
		return "absent";
	}
}

/**
 * Stream the model to a `.part` file with 1%-granularity progress broadcasts,
 * validate size + GGML magic, then atomically rename into place. Mirrors the
 * DMG download pattern in `updater.ts`.
 */
async function downloadModel(): Promise<void> {
	const dest = modelPath();
	const part = `${dest}.part`;
	await fs.mkdir(dirname(dest), { recursive: true });
	try {
		await new Promise<void>((resolvePromise, rejectPromise) => {
			const req = net.request({ url: MODEL_URL, method: "GET", redirect: "follow" });
			req.on("response", (res) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					rejectPromise(new Error(`Model download failed: HTTP ${res.statusCode}`));
					return;
				}
				const total = parseInt(
					String(res.headers["content-length"] ?? "0"),
					10,
				) || MODEL_BYTES;
				let received = 0;
				let lastPct = -1;
				const out = createWriteStream(part);
				res.on("data", (chunk: Buffer) => {
					received += chunk.length;
					out.write(chunk);
					const pct = Math.floor((received / total) * 100);
					// Rate-limit progress broadcasts to 1% granularity.
					if (pct !== lastPct) {
						lastPct = pct;
						broadcast("dictation:downloadProgress", { received, total, percent: pct });
					}
				});
				res.on("end", () => {
					out.end();
					out.on("finish", () => resolvePromise());
					out.on("error", rejectPromise);
				});
				res.on("error", rejectPromise);
			});
			req.on("error", rejectPromise);
			req.end();
		});

		// Sanity checks: plausible size and GGML magic bytes.
		const stat = await fs.stat(part);
		if (stat.size < MODEL_BYTES * 0.9) {
			throw new Error("Model download incomplete (file too small)");
		}
		const fh = await fs.open(part, "r");
		try {
			const buf = Buffer.alloc(4);
			await fh.read(buf, 0, 4, 0);
			if (buf.readUInt32LE(0) !== GGML_MAGIC) {
				throw new Error("Downloaded model failed integrity check (bad magic)");
			}
		} finally {
			await fh.close();
		}
		await fs.rename(part, dest);
	} catch (err) {
		await fs.rm(part, { force: true });
		throw err;
	}
}

async function transcribe(pcm: Float32Array): Promise<string> {
	const result = await getWhisper()({
		pcmf32: pcm,
		model: modelPath(),
		language: "en",
		use_gpu: true,
		flash_attn: false,
		no_prints: true,
		comma_in_time: false,
		translate: false,
		no_timestamps: false,
		audio_ctx: 0,
		max_len: 0,
	});
	return result.transcription
		.map((row) => row[2] ?? "")
		.join("")
		.trim();
}

export function registerDictationHandlers(): void {
	ipcMain.handle("dictation:modelStatus", async (): Promise<{ state: ModelState }> => ({
		state: await modelState(),
	}));

	ipcMain.handle("dictation:downloadModel", async (): Promise<void> => {
		if (downloading) return;
		if ((await modelState()) === "ready") return;
		downloading = true;
		try {
			await downloadModel();
		} finally {
			downloading = false;
		}
	});

	ipcMain.handle("dictation:requestMicAccess", async (): Promise<boolean> => {
		// Triggers the macOS TCC prompt on first ask; resolves the current
		// grant state on subsequent calls.
		return systemPreferences.askForMediaAccess("microphone");
	});

	ipcMain.handle(
		"dictation:transcribe",
		async (_e, pcm: Float32Array): Promise<string> => {
			if ((await modelState()) !== "ready") {
				throw new Error("Dictation model not downloaded yet");
			}
			const run = transcribeChain.then(() => transcribe(pcm), () => transcribe(pcm));
			transcribeChain = run.catch(() => undefined);
			return run;
		},
	);
}
