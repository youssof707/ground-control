import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import {
	ScheduleSchema,
	type Schedule,
	type SchedulePatch,
	type SchedulesFile,
} from "../../../shared/schemas/schedules";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: SchedulesFile = { items: {} };

const RawFileSchema = z.object({
	items: z.record(z.string(), z.unknown()),
});

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"Schedules store not initialized. Call initialize(dataDir) first.",
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

function stripUndefined<T extends object>(obj: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out as T;
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "schedules.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: SchedulesFile = { items: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		const parsed = RawFileSchema.parse(raw);
		const items: Record<string, Schedule> = {};
		let dropped = false;
		for (const [id, value] of Object.entries(parsed.items)) {
			const result = ScheduleSchema.safeParse(value);
			if (result.success) {
				items[id] = result.data;
			} else {
				dropped = true;
				console.warn(`[schedule] dropping unparseable schedule ${id}`);
			}
		}
		db = { items };
		if (dropped) await persist();
	}

	initialized = true;
}

export function list(): Schedule[] {
	assertInitialized();
	return Object.values(db.items).map((s) => structuredClone(s));
}

export function get(id: string): Schedule | undefined {
	assertInitialized();
	const item = db.items[id];
	return item ? structuredClone(item) : undefined;
}

export async function create(entry: Schedule): Promise<Schedule> {
	assertInitialized();
	const validated = ScheduleSchema.parse(stripUndefined(entry));
	return enqueue(async () => {
		if (db.items[validated.id]) {
			throw new Error(`Schedule ${validated.id} already exists`);
		}
		db.items[validated.id] = validated;
		await persist();
		return structuredClone(validated);
	});
}

export async function update(
	id: string,
	patch: SchedulePatch,
): Promise<Schedule | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		const merged = ScheduleSchema.parse(
			stripUndefined({ ...current, ...patch }),
		);
		db.items[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

export async function remove(id: string): Promise<Schedule | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.items[id];
		if (!current) return null;
		delete db.items[id];
		await persist();
		return structuredClone(current);
	});
}
