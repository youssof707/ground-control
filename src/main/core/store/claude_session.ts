import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	ClaudeSessionFullSchema,
	ClaudeSessionsFileSchema,
	type ClaudeSessionFull,
	type ClaudeSessionsFile,
	type SessionMessage,
	type SessionStatus,
} from "../../../shared/schemas/claude_session";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: ClaudeSessionsFile = { items: {} };
// Tombstones for sessions that have been (or are being) deleted. Added
// synchronously in `deleteSession` so any already-enqueued appendMessage /
// updateSession tasks for the same id short-circuit when they finally run.
// Without this, a busy session with many queued message writes could block
// the delete for seconds behind a stack of full-file `writeFileAtomic`
// flushes. Tombstones are in-memory only — after restart the row is gone
// from disk so the natural `if (!current) return` guards do the same job.
const tombstones = new Set<string>();

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"ClaudeSession store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "claude_sessions.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: ClaudeSessionsFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = ClaudeSessionsFileSchema.parse(raw);
	}

	// Sessions that were open when the previous process died can't be resumed
	// — the SDK loop is gone. Mark them cancelled so the UI hides the
	// composer and the activity ticker stops.
	let mutated = false;
	for (const id of Object.keys(db.items)) {
		const s = db.items[id];
		if (
			s.status === "running" ||
			s.status === "idle" ||
			s.status === "awaiting_permission"
		) {
			db.items[id] = {
				...s,
				status: "cancelled",
				finishedAt: s.finishedAt ?? Date.now(),
			};
			mutated = true;
		}
	}
	if (mutated) await persist();

	initialized = true;
}

export function getSession(id: string): ClaudeSessionFull | null {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : null;
}

export function listSessions(): ClaudeSessionFull[] {
	assertInitialized();
	return Object.values(db.items).map((s) => structuredClone(s));
}

export async function createSession(
	session: ClaudeSessionFull,
): Promise<ClaudeSessionFull> {
	assertInitialized();
	const validated = ClaudeSessionFullSchema.parse(session);
	// Defensive: random UUIDs don't collide, but clear any prior tombstone
	// for the id so writes after this create aren't silently dropped.
	tombstones.delete(validated.id);
	return enqueue(async () => {
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

export type SessionPatch = Partial<
	Pick<
		ClaudeSessionFull,
		| "title"
		| "status"
		| "finishedAt"
		| "error"
		| "branch"
		| "lastUserMessageBranch"
		| "startCommit"
		| "diff"
		| "sdkSessionId"
		| "mode"
		| "archivedAt"
	>
>;

export async function updateSession(
	id: string,
	patch: SessionPatch,
): Promise<ClaudeSessionFull | null> {
	assertInitialized();
	return enqueue(async () => {
		// Short-circuit tombstoned ids so a long queue of pending updates
		// from a still-winding-down SDK loop drains instantly behind the
		// delete instead of doing a full-file `writeFileAtomic` per task.
		if (tombstones.has(id)) return null;
		const current = db.items[id];
		// Tolerate missing rows: an active session can be deleted concurrently;
		// late updates from its winding-down loop should silently no-op rather
		// than blow up.
		if (!current) return null;
		const merged = { ...current, ...patch };
		const validated = ClaudeSessionFullSchema.parse(merged);
		db.items[id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

export async function appendMessage(
	id: string,
	msg: SessionMessage,
): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		// Same short-circuit as updateSession — without this, a session with
		// dozens of queued message appends would force the delete to wait
		// behind every full-file flush.
		if (tombstones.has(id)) return;
		const current = db.items[id];
		if (!current) return;
		const merged = { ...current, messages: [...current.messages, msg] };
		const validated = ClaudeSessionFullSchema.parse(merged);
		db.items[id] = validated;
		await persist();
	});
}

// Mirror the renderer's status-only update (used when only the status
// changes). Same as updateSession({status}) but a slightly cheaper path.
export async function setSessionStatus(
	id: string,
	status: SessionStatus,
): Promise<void> {
	await updateSession(id, { status });
}

/**
 * Hard-delete a session record from this app's storage. Does NOT touch the
 * underlying Claude Agent SDK's session state (which lives in ~/.claude).
 *
 * Synchronously tombstones the id before enqueuing the actual delete so
 * any already-queued appendMessage / updateSession tasks for the same id
 * (e.g. from a busy SDK loop) see the tombstone the moment they run and
 * skip their full-file flush. This is what keeps the delete IPC fast
 * even on a chatty session.
 */
export async function deleteSession(id: string): Promise<void> {
	assertInitialized();
	tombstones.add(id);
	return enqueue(async () => {
		if (!db.items[id]) return;
		delete db.items[id];
		await persist();
	});
}
