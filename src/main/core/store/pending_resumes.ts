import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { enqueue } from "./write_queue";

export const PendingResumeSchema = z.object({
	runtimeId: z.string(),
	resumeAt: z.number(),
	attempts: z.number().int().nonnegative(),
});

export type SavedResume = z.infer<typeof PendingResumeSchema>;

const RawFileSchema = z.object({
	items: z.record(z.string(), z.unknown()),
});

let filePath: string | null = null;
let items: Record<string, SavedResume> = {};

async function readJsonOrNull(p: string): Promise<unknown | null> {
	try {
		return JSON.parse(await fs.readFile(p, "utf8"));
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

async function persist(): Promise<void> {
	if (!filePath) return;
	await writeFileAtomic(filePath, JSON.stringify({ items }, null, 2));
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "pending_resumes.json");
	const raw = await readJsonOrNull(filePath);
	items = {};
	if (raw === null) return;
	const parsed = RawFileSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("[auto-resume] dropping unparseable pending_resumes.json");
		return;
	}
	for (const [id, value] of Object.entries(parsed.data.items)) {
		const result = PendingResumeSchema.safeParse(value);
		if (result.success) items[id] = result.data;
	}
}

export function list(): SavedResume[] {
	return Object.values(items).map((e) => ({ ...e }));
}

export function save(entry: SavedResume): Promise<void> {
	const validated = PendingResumeSchema.parse(entry);
	return enqueue(async () => {
		items[validated.runtimeId] = validated;
		await persist();
	});
}

export function remove(runtimeId: string): Promise<void> {
	return enqueue(async () => {
		if (!items[runtimeId]) return;
		delete items[runtimeId];
		await persist();
	});
}
