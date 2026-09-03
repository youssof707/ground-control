import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	AppSettingsFileSchema,
	type AppSettingsFile,
} from "../../../shared/schemas/app_settings";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: AppSettingsFile = {};

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"AppSettings store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "app_settings.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: AppSettingsFile = {};
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = AppSettingsFileSchema.parse(raw);
	}

	initialized = true;
}

export function get(): AppSettingsFile {
	assertInitialized();
	return { ...db };
}

export async function setLastUsedWorkspace(cwd: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (db.lastUsedWorkspace === cwd) return;
		db = { ...db, lastUsedWorkspace: cwd };
		await persist();
	});
}

/**
 * Remember — or forget, with an `undefined` `worktreeId` — which worktree was
 * last used in `cwd`.
 *
 * Forgetting is a real signal, not a no-op: starting a plain non-worktree
 * session in a folder means "I'm working on the base checkout now", and the
 * next New Session there should not resurrect a worktree the user moved away
 * from. Deletes the key rather than storing `undefined` so `persist()` can't
 * emit a `null` the schema would reject on next boot.
 */
export async function setLastUsedWorktree(
	cwd: string,
	worktreeId: string | undefined,
): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		const map = db.lastUsedWorktreeByWorkspace ?? {};
		if (map[cwd] === worktreeId) return;
		const next = { ...map };
		if (worktreeId === undefined) delete next[cwd];
		else next[cwd] = worktreeId;
		db = { ...db, lastUsedWorktreeByWorkspace: next };
		await persist();
	});
}

/**
 * Set — or clear, with `undefined` — the app-wide default model.
 *
 * The only setter in this file that accepts a clearing `undefined`.
 * `JSON.stringify` drops undefined-valued keys, so `persist()` writes the
 * key out of existence rather than emitting `"defaultModel": null` (which
 * the schema would reject on the next boot).
 */
export async function setDefaultModel(model: string | undefined): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (db.defaultModel === model) return;
		db = { ...db, defaultModel: model };
		await persist();
	});
}

export async function setSessionsSidebarWidth(width: number): Promise<void> {
	assertInitialized();
	// Pointer events on high-DPI displays produce fractional clientX values,
	// which would violate the `int()` schema on next boot. Round at the
	// single chokepoint so no caller can poison the JSON.
	const w = Math.round(width);
	return enqueue(async () => {
		if (db.sessionsSidebarWidth === w) return;
		db = { ...db, sessionsSidebarWidth: w };
		await persist();
	});
}

export async function setNotesSidebarWidth(width: number): Promise<void> {
	assertInitialized();
	const w = Math.round(width);
	return enqueue(async () => {
		if (db.notesSidebarWidth === w) return;
		db = { ...db, notesSidebarWidth: w };
		await persist();
	});
}

export async function setSidequestSidebarWidth(width: number): Promise<void> {
	assertInitialized();
	const w = Math.round(width);
	return enqueue(async () => {
		if (db.sidequestSidebarWidth === w) return;
		db = { ...db, sidequestSidebarWidth: w };
		await persist();
	});
}
