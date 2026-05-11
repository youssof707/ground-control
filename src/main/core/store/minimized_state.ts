import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	MinimizedStateFileSchema,
	type MinimizedStateFile,
} from "../../../shared/schemas/minimized_state";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: MinimizedStateFile = { minimized: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"MinimizedState store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "minimized_permissions.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: MinimizedStateFile = { minimized: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = MinimizedStateFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): MinimizedStateFile {
	assertInitialized();
	return { minimized: { ...db.minimized } };
}

/**
 * Set the minimized flag for a session. Storing `false` removes the entry
 * entirely so the file doesn't accumulate stale `false` keys for every
 * session the user ever expanded.
 */
export async function set(
	sessionId: string,
	value: boolean,
): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.minimized[sessionId] ?? false;
		if (current === value) return;
		const next = { ...db.minimized };
		if (value) {
			next[sessionId] = true;
		} else {
			delete next[sessionId];
		}
		db.minimized = next;
		await persist();
	});
}

/**
 * Remove a session's entry entirely. Called from `session:delete` so stale
 * flags don't accumulate for sessions that no longer exist.
 */
export async function clear(sessionId: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (!(sessionId in db.minimized)) return;
		const next = { ...db.minimized };
		delete next[sessionId];
		db.minimized = next;
		await persist();
	});
}
