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
		| "startCommit"
		| "diff"
		| "sdkSessionId"
		| "mode"
	>
>;

export async function updateSession(
	id: string,
	patch: SessionPatch,
): Promise<ClaudeSessionFull | null> {
	assertInitialized();
	return enqueue(async () => {
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
 */
export async function deleteSession(id: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (!db.items[id]) return;
		delete db.items[id];
		await persist();
	});
}
