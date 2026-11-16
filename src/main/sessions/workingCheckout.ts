import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";

const EDIT_TOOLS: Record<string, string> = {
	Edit: "file_path",
	Write: "file_path",
	MultiEdit: "file_path",
	NotebookEdit: "notebook_path",
};

export function editTarget(toolName: string, toolInput: unknown, cwd: string | undefined): string | null {
	const key = EDIT_TOOLS[toolName];
	if (!key || typeof toolInput !== "object" || toolInput === null) return null;
	const path = (toolInput as Record<string, unknown>)[key];
	if (typeof path !== "string" || !path) return null;
	if (isAbsolute(path)) return dirname(path);
	if (!cwd) return null;
	return dirname(resolve(cwd, path));
}

export class WorkDirTracker {
	private cwd: string | null = null;
	last: string | null = null;

	entry(entry: unknown): void {
		if (typeof entry !== "object" || entry === null) return;
		const record = entry as Record<string, unknown>;
		const cwd = typeof record.cwd === "string" && record.cwd ? record.cwd : null;
		if (cwd && cwd !== this.cwd) {
			this.cwd = cwd;
			this.last = cwd;
		}
		if (record.type !== "assistant") return;
		const message = record.message as { content?: unknown } | undefined;
		if (!Array.isArray(message?.content)) return;
		for (const block of message.content as unknown[]) {
			if (typeof block !== "object" || block === null) continue;
			const { type, name, input } = block as Record<string, unknown>;
			if (type !== "tool_use" || typeof name !== "string") continue;
			const target = editTarget(name, input, cwd ?? this.cwd ?? undefined);
			if (target) this.last = target;
		}
	}
}

export async function lastWorkDirInTranscript(file: string): Promise<string | null> {
	const tracker = new WorkDirTracker();
	const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
	for await (const line of lines) {
		if (!line) continue;
		try {
			tracker.entry(JSON.parse(line));
		} catch {
			continue;
		}
	}
	return tracker.last;
}

async function nearestExistingDir(dir: string): Promise<string | null> {
	let current = dir;
	while (true) {
		try {
			if ((await fs.stat(current)).isDirectory()) return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}
}

export async function gitToplevel(dir: string): Promise<string | null> {
	const cwd = await nearestExistingDir(dir);
	if (!cwd) return null;
	return new Promise((done) => {
		execFile(
			"git",
			["rev-parse", "--path-format=absolute", "--show-toplevel"],
			{ cwd, timeout: 15_000 },
			(err, stdout) => {
				const top = err ? "" : stdout.trim();
				done(top || null);
			},
		);
	});
}
