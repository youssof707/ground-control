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
