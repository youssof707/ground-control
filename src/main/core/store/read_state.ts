import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	ReadStateFileSchema,
	type ReadStateFile,
} from "../../../shared/schemas/read_state";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: ReadStateFile = { lastReadAt: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"ReadState store not initialized. Call initialize(dataDir) first.",
		);
	}
}

async function readJsonOrNull(p: string): Promise<unknown | null> {
	try {
		const text = await fs.readFile(p, "utf8");
		return JSON.parse(text);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

async function persist(): Promise<void> {
	if (!filePath) throw new Error("filePath not set");
	await writeFileAtomic(filePath, JSON.stringify(db, null, 2));
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "read_state.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: ReadStateFile = { lastReadAt: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = ReadStateFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): ReadStateFile {
	assertInitialized();
	return { lastReadAt: { ...db.lastReadAt } };
}

/**
 * Mark a session read at `ts` (defaults to now). Monotonic: a smaller `ts`
 * than what's already stored is silently dropped, so an out-of-order ping
 * from a slow window can't roll back read state.
 */
export async function mark(sessionId: string, ts?: number): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		const next = ts ?? Date.now();
		const current = db.lastReadAt[sessionId] ?? 0;
		if (current >= next) return;
		db.lastReadAt = { ...db.lastReadAt, [sessionId]: next };
		await persist();
	});
}

/**
 * Roll a session back to "unread" by deleting its entry. Bypasses the
 * monotonic guard in `mark` — the whole point is to undo a previous read.
 * Next time the row is rendered, `lastReadAt` defaults to 0 and any
 * incoming-message timestamp will exceed it, so the unread dot returns.
 */
export async function unmark(sessionId: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (!(sessionId in db.lastReadAt)) return;
		const next = { ...db.lastReadAt };
		delete next[sessionId];
		db.lastReadAt = next;
		await persist();
	});
}
