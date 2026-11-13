import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

interface WhisperResult {
	transcription: Array<[string, string, string]>;
}

type WhisperFn = (params: Record<string, unknown>) => Promise<WhisperResult>;

export interface WhisperRequest {
	id: number;
	pcm: Float32Array;
	model: string;
}

export type WhisperResponse =
	| { id: number; text: string }
	| { id: number; error: string };

const nodeRequire = createRequire(import.meta.url);
let whisperFn: WhisperFn | null = null;

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

export async function transcribe(pcm: Float32Array, model: string): Promise<string> {
	const result = await getWhisper()({
		pcmf32: pcm,
		model,
		language: "en",
		use_gpu: false,
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
		.replace(/\[\s*blank[\s_-]*audio\s*\]/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

const port = process.parentPort;
if (port) {
	let chain: Promise<unknown> = Promise.resolve();
	port.on("message", (e: { data: WhisperRequest }) => {
		const { id, pcm, model } = e.data;
		chain = chain.then(async () => {
			let reply: WhisperResponse;
			try {
				reply = { id, text: await transcribe(pcm, model) };
			} catch (err) {
				reply = { id, error: err instanceof Error ? err.message : String(err) };
			}
			port.postMessage(reply);
		});
	});
}
