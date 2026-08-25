import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	PromptShortcutSchema,
	PromptShortcutsFileSchema,
	type PromptShortcut,
	type PromptShortcutsFile,
} from "../../../shared/schemas/promptShortcuts";
import { enqueue } from "./write_queue";

/**
 * File-backed store for saved in-session prompt shortcuts. Structural twin
 * of the `shortcuts` store (which holds the cwd-carrying new-session
 * shortcuts): module-level singleton, whole-file JSON persisted atomically,
 * every mutation an entire read-modify-write inside a single write-queue
 * task, every read returning a structuredClone.
 */

let initialized = false;
let filePath: string | null = null;
let db: PromptShortcutsFile = { items: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"Prompt shortcuts store not initialized. Call initialize(dataDir) first.",
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
	filePath = path.join(dataDir, "prompt_shortcuts.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: PromptShortcutsFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = PromptShortcutsFileSchema.parse(raw);
	}

	initialized = true;
}

export function list(): PromptShortcut[] {
	assertInitialized();
	return Object.values(db.items).map((s) => structuredClone(s));
}

export function get(id: string): PromptShortcut | undefined {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : undefined;
}

export async function create(entry: PromptShortcut): Promise<PromptShortcut> {
	assertInitialized();
	const validated = PromptShortcutSchema.parse(entry);
	return enqueue(async () => {
		if (db.items[validated.id]) {
			throw new Error(`Prompt shortcut ${validated.id} already exists`);
		}
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

export async function update(
	id: string,
	patch: Partial<Pick<PromptShortcut, "title" | "prompt" | "mode">>,
): Promise<PromptShortcut | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		const merged: PromptShortcut = PromptShortcutSchema.parse({
			...current,
			...patch,
		});
		db.items[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

export async function remove(id: string): Promise<PromptShortcut | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		delete db.items[id];
		await persist();
		return structuredClone(current);
	});
}
