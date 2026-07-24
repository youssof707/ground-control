import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	SessionGroupSchema,
	SessionGroupsFileSchema,
	type SessionGroup,
	type SessionGroupsFile,
} from "../../../shared/schemas/session_groups";
import { enqueue } from "./write_queue";

/**
 * Registry of sidebar session groups. Lives in its own JSON file
 * (`session_groups.json`, sibling of `claude_sessions.json`) so writes are
 * cheap. Mirrors the `worktrees` store's read-modify-write-atop-shared-queue
 * pattern, minus everything git.
 *
 * Deliberately no `sessionIds` reverse index: membership lives on
 * `ClaudeSession.groupId` only, and "is this group empty?" is answered by
 * scanning the session store (see `pruneGroupIfEmpty` in groupsHandlers).
 * One source of truth — no cross-store sync to keep honest. Archived
 * sessions keep their membership and count as members for the emptiness
 * check.
 */

let initialized = false;
let filePath: string | null = null;
let db: SessionGroupsFile = { items: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"Session groups store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "session_groups.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: SessionGroupsFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = SessionGroupsFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): SessionGroup[] {
	assertInitialized();
	return Object.values(db.items).map((g) => structuredClone(g));
}

export function get(id: string): SessionGroup | undefined {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : undefined;
}

export async function create(entry: SessionGroup): Promise<SessionGroup> {
	assertInitialized();
	const validated = SessionGroupSchema.parse(entry);
	return enqueue(async () => {
		if (db.items[validated.id]) {
			throw new Error(`Session group ${validated.id} already exists`);
		}
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

/**
 * Persist a collapse/expand toggle. Missing group is a no-op (returns null)
 * rather than throwing — the toggle can race an auto-delete from another
 * window, and "the group is gone" is a fine outcome for a collapse click.
 */
export async function setCollapsed(
	id: string,
	collapsed: boolean,
): Promise<SessionGroup | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		if (current.collapsed === collapsed) return structuredClone(current);
		const merged: SessionGroup = SessionGroupSchema.parse({
			...current,
			collapsed,
		});
		db.items[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

/**
 * Rename a group. Missing group returns null (mirrors `setCollapsed`'s
 * silent no-op — a rename can race an auto-delete from another window,
 * and the modal already surfaces the error in that slot). No-op if the
 * name is unchanged so persistence is skipped on redundant saves.
 * The caller is responsible for trim + non-empty validation.
 */
export async function setName(
	id: string,
	name: string,
): Promise<SessionGroup | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		if (current.name === name) return structuredClone(current);
		const merged: SessionGroup = SessionGroupSchema.parse({
			...current,
			name,
		});
		db.items[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

/**
 * Remove a group from the registry. No guards — the only caller is the
 * auto-delete path (`pruneGroupIfEmpty`), which has already established
 * the group has zero members. Missing id is a no-op (returns null).
 */
export async function remove(id: string): Promise<SessionGroup | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		delete db.items[id];
		await persist();
		return structuredClone(current);
	});
}
