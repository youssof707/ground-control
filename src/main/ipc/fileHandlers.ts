import { ipcMain } from "electron";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { FileViewContent, FileViewRequest, FileViewResult } from "../../shared/schemas/file_view";
import { HARD_LIMIT, isBinary } from "../sourceControl/content";
import { decodeBytes } from "../sourceControl/parseStatus";

const SNIFF_BYTES = 8000;

export function resolveFilePath(path: string, cwd: string | undefined): string | null {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (isAbsolute(path)) return resolve(path);
	if (!cwd || !isAbsolute(cwd)) return null;
	return resolve(cwd, path);
}

async function readHead(path: string, size: number): Promise<Buffer> {
	const handle = await fs.open(path, "r");
	try {
		const head = Buffer.alloc(Math.min(SNIFF_BYTES, size));
		await handle.read(head, 0, head.length, 0);
		return head;
	} finally {
		await handle.close();
	}
}

async function readFileView(path: string): Promise<FileViewContent> {
	let stat;
	try {
		stat = await fs.stat(path);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { kind: "gone" };
		return { kind: "error", message: (err as Error).message };
	}
	if (stat.isDirectory()) return { kind: "directory" };
	if (!stat.isFile()) return { kind: "error", message: "Not a regular file" };
	try {
		if (stat.size > HARD_LIMIT) {
			if (isBinary(await readHead(path, stat.size))) return { kind: "binary" };
			return { kind: "too-large", bytes: stat.size };
		}
		const data = await fs.readFile(path);
		if (isBinary(data)) return { kind: "binary" };
		const { text, lossy } = decodeBytes(data);
		return { kind: "text", text, lossy };
	} catch (err) {
		return { kind: "error", message: (err as Error).message };
	}
}

export function registerFileHandlers(): void {
	ipcMain.handle("file:read", async (_e, request: FileViewRequest): Promise<FileViewResult> => {
		const raw = typeof request?.path === "string" ? request.path : "";
		const cwd = typeof request?.cwd === "string" ? request.cwd : undefined;
		const path = raw ? resolveFilePath(raw, cwd) : null;
		if (!path) return { path: raw, kind: "error", message: "Can't tell which folder this path is relative to" };
		return { path, ...(await readFileView(path)) };
	});
}
