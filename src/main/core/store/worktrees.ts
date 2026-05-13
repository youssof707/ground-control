import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	WorktreeSchema,
	WorktreesFileSchema,
	type Worktree,
	type WorktreesFile,
} from "../../../shared/schemas/worktree";
import { enqueue } from "./write_queue";

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

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
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

export function getWorktree(id: string): Worktree | undefined {
	assertInitialized();
	const w = db.items[id];
	return w ? structuredClone(w) : undefined;
}

export function listWorktrees(): Worktree[] {
	assertInitialized();
	return Object.values(db.items).map((w) => structuredClone(w));
}

/**
 * Return worktrees whose `originalCwd` exactly matches `repoToplevel`. The
 * caller is expected to have canonicalized `repoToplevel` via `git rev-parse
 * --show-toplevel` so subdir paths into the same repo collapse correctly.
 */
export function listForRepo(repoToplevel: string): Worktree[] {
	assertInitialized();
	return Object.values(db.items)
		.filter((w) => w.originalCwd === repoToplevel)
		.map((w) => structuredClone(w));
}

export async function createWorktree(record: Worktree): Promise<Worktree> {
	assertInitialized();
	const validated = WorktreeSchema.parse(record);
	return enqueue(async () => {
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

/**
 * Remove a worktree record from the on-disk store. Idempotent — a missing
 * id is a no-op. Callers (the session-delete IPC) are responsible for
 * tearing down the actual filesystem worktree via `destroyWorktree` BEFORE
 * calling this, so a failure to remove the record can't leave the user
 * with a dangling reference + missing directory.
 */
export async function deleteWorktree(id: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (!db.items[id]) return;
		delete db.items[id];
		await persist();
	});
}
