import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	WorktreeSchema,
	WorktreesFileSchema,
	type Worktree,
	type WorktreesFile,
} from "../../../shared/schemas/worktrees";
import { enqueue } from "./write_queue";

/**
 * App-owned registry of git worktrees. Lives in its own JSON file
 * (`worktrees.json`, sibling of `claude_sessions.json`) so writes are
 * cheap even as the session store grows. Mirrors the `session_notes`
 * store's read-modify-write-atop-shared-queue pattern.
 *
 * The on-disk checkouts themselves live under `<dataDir>/worktrees/<id>/`
 * — created by the git-side helper (`worktreeAdd`), not by this store.
 * This store only tracks metadata.
 */

let initialized = false;
let filePath: string | null = null;
let db: WorktreesFile = { items: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"Worktrees store not initialized. Call initialize(dataDir) first.",
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

/**
 * Directory the git-side helper should carve its checkouts into. Callers
 * (worktreesHandlers.create) compute `path.join(worktreesDir(), id)` to
 * pick a stable, deterministic path per worktree id.
 */
export function worktreesDir(dataDir: string): string {
	return path.join(dataDir, "worktrees");
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	// Ensure the checkouts dir exists too — safe to create up-front so the
	// git-side helper can assume its parent is present.
	await fs.mkdir(worktreesDir(dataDir), { recursive: true });
	filePath = path.join(dataDir, "worktrees.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: WorktreesFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = WorktreesFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): Worktree[] {
	assertInitialized();
	return Object.values(db.items).map((w) => structuredClone(w));
}

export function listForBaseDir(baseDir: string): Worktree[] {
	assertInitialized();
	return Object.values(db.items)
		.filter((w) => w.baseDir === baseDir)
		.map((w) => structuredClone(w));
}

export function get(id: string): Worktree | undefined {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : undefined;
}

export async function create(entry: Worktree): Promise<Worktree> {
	assertInitialized();
	const validated = WorktreeSchema.parse(entry);
	return enqueue(async () => {
		if (db.items[validated.id]) {
			throw new Error(`Worktree ${validated.id} already exists`);
		}
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

/**
 * Append `sessionId` to the given worktree's `sessionIds` if not already
 * present. Idempotent — safe to call from `SessionManager.run` and from
 * `fork` without worrying about duplicates.
 *
 * Missing worktree is a no-op (returns null) rather than throwing: the
 * session may still be created and live on with a dangling reference,
 * which is the same behavior as an externally-deleted worktree.
 */
export async function attachSession(
	worktreeId: string,
	sessionId: string,
): Promise<Worktree | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[worktreeId];
		if (!current) return null;
		if (current.sessionIds.includes(sessionId)) {
			return structuredClone(current);
		}
		const merged: Worktree = WorktreeSchema.parse({
			...current,
			sessionIds: [...current.sessionIds, sessionId],
		});
		db.items[worktreeId] = merged;
		await persist();
		return structuredClone(merged);
	});
}

export async function detachSession(
	worktreeId: string,
	sessionId: string,
): Promise<Worktree | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[worktreeId];
		if (!current) return null;
		if (!current.sessionIds.includes(sessionId)) {
			return structuredClone(current);
		}
		const merged: Worktree = WorktreeSchema.parse({
			...current,
			sessionIds: current.sessionIds.filter((sid) => sid !== sessionId),
		});
		db.items[worktreeId] = merged;
		await persist();
		return structuredClone(merged);
	});
}

/**
 * Remove a worktree from the registry. Throws if any session still
 * references it — the caller (IPC handler) should surface the error
 * to the user. Physical `git worktree remove` is the caller's job.
 */
export async function remove(id: string): Promise<Worktree | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		if (current.sessionIds.length > 0) {
			throw new Error(
				`Cannot delete worktree "${current.displayName}" — ${current.sessionIds.length} session(s) still reference it.`,
			);
		}
		delete db.items[id];
		await persist();
		return structuredClone(current);
	});
}
