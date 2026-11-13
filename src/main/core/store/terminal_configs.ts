import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	TerminalConfigsFileSchema,
	type TerminalConfig,
	type TerminalConfigsFile,
} from "../../../shared/schemas/terminals";
import { resolveDataDir } from "./data_dir";
import { enqueue } from "./write_queue";

let cache: TerminalConfigsFile | null = null;

function filePath(): string {
	return path.join(resolveDataDir(), "terminal_configs.json");
}

async function load(): Promise<TerminalConfigsFile> {
	if (cache) return cache;
	try {
		const text = await fs.readFile(filePath(), "utf8");
		cache = TerminalConfigsFileSchema.parse(JSON.parse(text));
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		cache = { items: [] };
	}
	return cache;
}

async function persist(next: TerminalConfigsFile): Promise<void> {
	await fs.mkdir(path.dirname(filePath()), { recursive: true });
	await writeFileAtomic(filePath(), JSON.stringify(next, null, 2));
	cache = next;
}

export async function listTerminalConfigs(): Promise<TerminalConfig[]> {
	const file = await load();
	return [...file.items].sort((a, b) => b.savedAt - a.savedAt);
}

export async function getTerminalConfig(
	id: string,
): Promise<TerminalConfig | null> {
	const file = await load();
	return file.items.find((item) => item.id === id) ?? null;
}

export function saveTerminalConfig(
	input: Omit<TerminalConfig, "id" | "savedAt">,
): Promise<TerminalConfig> {
	return enqueue(async () => {
		const file = await load();
		const existing = file.items.find(
			(item) => item.name === input.name && item.cwd === input.cwd,
		);
		const saved: TerminalConfig = {
			...input,
			id: existing?.id ?? randomUUID(),
			savedAt: Date.now(),
		};
		await persist({
			items: [...file.items.filter((item) => item.id !== saved.id), saved],
		});
		return saved;
	});
}

export function deleteTerminalConfig(id: string): Promise<void> {
	return enqueue(async () => {
		const file = await load();
		await persist({ items: file.items.filter((item) => item.id !== id) });
	});
}
