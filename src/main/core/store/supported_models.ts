import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	SupportedModelsFileSchema,
	type SupportedModelEntry,
} from "../../../shared/schemas/supported_models";
import { enqueue } from "./write_queue";

/**
 * File-backed cache of the SDK's supported-models list. Read once on boot;
 * refreshed every time any session's live query returns a fresh list. Lets
 * the model picker skip the hardcoded FALLBACK_MODELS stub on every launch
 * after the first successful fetch — stub only appears on cold installs
 * (no persisted list yet) with no live query available.
 */

let initialized = false;
let filePath: string | null = null;
// `null` distinguishes "never fetched" (show FALLBACK_MODELS) from "fetched
// but empty" (which would be a bug — we never persist empty lists).
let db: { models: SupportedModelEntry[]; fetchedAt: number } | null = null;

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"SupportedModels store not initialized. Call initialize(dataDir) first.",
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
	if (!db) return;
	await writeFileAtomic(filePath, JSON.stringify(db, null, 2));
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "supported_models.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		// No file yet — leave `db` as null so callers know we've never fetched.
		// Deliberately don't write an empty placeholder: presence of the file
		// itself is the signal that a real fetch has succeeded at least once.
		db = null;
	} else {
		try {
			db = SupportedModelsFileSchema.parse(raw);
		} catch (err) {
			// Corrupt / schema-mismatched file — treat as if it didn't exist so
			// the picker falls back gracefully and the next successful fetch
			// overwrites the bad file.
			console.error(
				"[ccw] supported_models.json failed to parse; ignoring:",
				err,
			);
			db = null;
		}
	}

	initialized = true;
}

/** Returns the cached list, or null if we've never persisted one. */
export function get(): SupportedModelEntry[] | null {
	assertInitialized();
	return db ? db.models.map((m) => ({ ...m })) : null;
}

/**
 * Overwrite the cache with a fresh list from the SDK. No-ops on empty input
 * (we never want to blow away a good cached list because of a transient SDK
 * hiccup that returned []).
 */
export async function set(models: SupportedModelEntry[]): Promise<void> {
	assertInitialized();
	if (models.length === 0) return;
	return enqueue(async () => {
		db = { models: models.map((m) => ({ ...m })), fetchedAt: Date.now() };
		await persist();
	});
}
