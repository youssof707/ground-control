import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { enqueue } from "./write_queue";

export const WindowStateSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	isMaximized: z.boolean(),
	isFullScreen: z.boolean(),
});

export type WindowState = z.infer<typeof WindowStateSchema>;

let filePath: string | null = null;
let state: WindowState | null = null;

async function readJsonOrNull(p: string): Promise<unknown | null> {
	try {
		return JSON.parse(await fs.readFile(p, "utf8"));
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		console.warn("[window-state] ignoring unreadable window_state.json", err);
		return null;
	}
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "window_state.json");
	state = null;
	const raw = await readJsonOrNull(filePath);
	if (raw === null) return;
	const parsed = WindowStateSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("[window-state] dropping unparseable window_state.json");
		return;
	}
	state = parsed.data;
}

export function get(): WindowState | null {
	return state ? { ...state } : null;
}

export function save(next: WindowState): Promise<void> {
	const validated = WindowStateSchema.parse({
		...next,
		x: Math.round(next.x),
		y: Math.round(next.y),
		width: Math.round(next.width),
		height: Math.round(next.height),
	});
	return enqueue(async () => {
		if (JSON.stringify(state) === JSON.stringify(validated)) return;
		state = validated;
		if (!filePath) return;
		await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
	});
}
