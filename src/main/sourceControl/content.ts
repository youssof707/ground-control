import { promises as fs } from "node:fs";
import type { ScmDiffContent } from "../../shared/schemas/source_control";
import { GitAbortedError, runGit } from "./gitProcess";
import { decodeBytes, type StatusEntry } from "./parseStatus";

export const SOFT_LIMIT = 1024 * 1024;
export const HARD_LIMIT = 8 * 1024 * 1024;
const SNIFF_BYTES = 8000;
const CONTENT_TIMEOUT_MS = 30_000;
const SUBMODULE_MODE = "160000";

type Side =
	| { kind: "bytes"; data: Buffer }
	| { kind: "too-large"; bytes: number }
	| { kind: "directory" }
	| { kind: "gone" }
	| { kind: "error"; message: string };

const EMPTY: Side = { kind: "bytes", data: Buffer.alloc(0) };

export function isBinary(data: Buffer): boolean {
	const end = Math.min(data.length, SNIFF_BYTES);
	for (let i = 0; i < end; i++) if (data[i] === 0) return true;
	return false;
}

export function checkoutPath(checkout: string, entry: StatusEntry): string | Buffer {
	if (!entry.raw) return `${checkout}/${entry.path}`;
	return Buffer.concat([Buffer.from(`${checkout}/`, "utf8"), entry.raw]);
}

async function blobSize(
	checkout: string,
	oid: string,
	signal: AbortSignal,
): Promise<number> {
	try {
		const result = await runGit({
			cwd: checkout,
			args: ["cat-file", "-s", oid],
			signal,
			timeoutMs: CONTENT_TIMEOUT_MS,
		});
		const size = Number(result.stdout.toString("utf8").trim());
		return Number.isFinite(size) ? size : -1;
	} catch {
		return -1;
	}
}

async function readBlob(
	checkout: string,
	oid: string | null,
	limit: number,
	signal: AbortSignal,
): Promise<Side> {
	if (!oid) return EMPTY;
	const result = await runGit({
		cwd: checkout,
		args: ["cat-file", "blob", oid],
		signal,
		timeoutMs: CONTENT_TIMEOUT_MS,
		maxStdout: limit + 1,
	});
	if (result.truncated) {
		if (isBinary(result.stdout)) return { kind: "bytes", data: result.stdout };
		return { kind: "too-large", bytes: await blobSize(checkout, oid, signal) };
	}
	if (result.code !== 0) {
		return { kind: "error", message: result.stderr.trim() || "git cat-file failed" };
	}
	return { kind: "bytes", data: result.stdout };
}

async function readModified(
	checkout: string,
	entry: StatusEntry,
	limit: number,
	signal: AbortSignal,
): Promise<Side> {
	if (entry.staged) return readBlob(checkout, entry.targetOid, limit, signal);
	if (entry.status === "D") return EMPTY;
	const target = checkoutPath(checkout, entry);
	let stat;
	try {
		stat = await fs.lstat(target);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { kind: "gone" };
		return { kind: "error", message: (err as Error).message };
	}
	if (stat.isSymbolicLink()) {
		const link = await fs.readlink(target, { encoding: "buffer" });
		return { kind: "bytes", data: link };
	}
	if (stat.isDirectory()) return { kind: "directory" };
	if (!stat.isFile()) return { kind: "error", message: "Not a regular file" };
	if (stat.size > limit) {
		const handle = await fs.open(target, "r");
		try {
			const head = Buffer.alloc(Math.min(SNIFF_BYTES, stat.size));
			await handle.read(head, 0, head.length, 0);
			if (isBinary(head)) return { kind: "bytes", data: head };
		} finally {
			await handle.close();
		}
		return { kind: "too-large", bytes: stat.size };
	}
	const data = await fs.readFile(target, { signal });
	return { kind: "bytes", data };
}

function sideError(err: unknown): Side {
	if (err instanceof GitAbortedError) throw err;
	if ((err as { name?: string }).name === "AbortError") throw new GitAbortedError();
	return { kind: "error", message: err instanceof Error ? err.message : String(err) };
}

export async function readDiff(
	checkout: string,
	entry: StatusEntry,
	options: { signal: AbortSignal; force: boolean },
): Promise<ScmDiffContent> {
	if (entry.path.endsWith("/")) return { kind: "directory" };
	if (
		entry.submodule ||
		entry.baseMode === SUBMODULE_MODE ||
		entry.targetMode === SUBMODULE_MODE
	) {
		return { kind: "submodule" };
	}

	const limit = options.force ? HARD_LIMIT : SOFT_LIMIT;
	const signal = AbortSignal.any([
		options.signal,
		AbortSignal.timeout(CONTENT_TIMEOUT_MS),
	]);
	const [original, modified] = await Promise.all([
		readBlob(checkout, entry.status === "U" ? null : entry.baseOid, limit, signal).catch(sideError),
		readModified(checkout, entry, limit, signal).catch(sideError),
	]);

	if (original.kind === "error") return original;
	if (modified.kind === "error") return modified;
	if (modified.kind === "gone") return { kind: "gone" };
	if (modified.kind === "directory") return { kind: "directory" };
	if (
		(original.kind === "bytes" && isBinary(original.data)) ||
		(modified.kind === "bytes" && isBinary(modified.data))
	) {
		return { kind: "binary" };
	}
	if (original.kind === "too-large" || modified.kind === "too-large") {
		const bytes = Math.max(
			original.kind === "too-large" ? original.bytes : 0,
			modified.kind === "too-large" ? modified.bytes : 0,
		);
		return {
			kind: "too-large",
			bytes,
			canForce: !options.force && bytes >= 0 && bytes <= HARD_LIMIT,
		};
	}
	if (original.kind !== "bytes" || modified.kind !== "bytes") {
		return { kind: "error", message: "Unreadable file" };
	}
	const before = decodeBytes(original.data);
	const after = decodeBytes(modified.data);
	return {
		kind: "text",
		original: before.text,
		modified: after.text,
		lossy: before.lossy || after.lossy,
	};
}
