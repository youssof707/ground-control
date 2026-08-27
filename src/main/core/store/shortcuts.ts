import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	ShortcutSchema,
	ShortcutsFileSchema,
	type Shortcut,
	type ShortcutsFile,
} from "../../../shared/schemas/shortcuts";
import { enqueue } from "./write_queue";

/**
 * File-backed store for saved shortcuts. Mirrors the session_groups store
 * structure exactly: module-level singleton, whole-file JSON persisted
 * atomically, every mutation an entire read-modify-write inside a single
 * write-queue task, every read returning a structuredClone.
 */

let initialized = false;
let filePath: string | null = null;
let db: ShortcutsFile = { items: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"Shortcuts store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "shortcuts.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: ShortcutsFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = ShortcutsFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): Shortcut[] {
	assertInitialized();
	return Object.values(db.items).map((s) => structuredClone(s));
}

export function get(id: string): Shortcut | undefined {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : undefined;
}

export async function create(entry: Shortcut): Promise<Shortcut> {
	assertInitialized();
	const validated = ShortcutSchema.parse(entry);
	return enqueue(async () => {
		if (db.items[validated.id]) {
			throw new Error(`Shortcut ${validated.id} already exists`);
		}
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

export async function update(
	id: string,
	patch: Partial<Pick<Shortcut, "title" | "prompt" | "mode">>,
): Promise<Shortcut | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		const merged: Shortcut = ShortcutSchema.parse({ ...current, ...patch });
		db.items[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

export async function remove(id: string): Promise<Shortcut | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		delete db.items[id];
		await persist();
		return structuredClone(current);
	});
}
