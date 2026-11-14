import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	SCM_GROUP_LIMIT,
	type ScmCheckout,
	type ScmFile,
	type ScmGroup,
	type ScmSnapshot,
} from "../../shared/schemas/source_control";
import {
	parseStatusV2,
	parseWorktreeList,
	type WorktreeEntry,
} from "./parseStatus";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_PARALLEL_CHECKOUTS = 4;
const MAX_BUFFER_ERROR = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

const inFlight = new Map<string, Promise<ScmSnapshot>>();

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["--no-optional-locks", ...args],
		{
			cwd,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: GIT_MAX_BUFFER,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		},
	);
	return stdout;
}

function statusArgs(untracked: "all" | "normal"): string[] {
	return [
		"status",
		"--porcelain=v2",
		"--branch",
		"-z",
		`--untracked-files=${untracked}`,
	];
}

async function readStatus(cwd: string): Promise<string> {
	try {
		return await git(cwd, statusArgs("all"));
	} catch (err) {
		if ((err as { code?: unknown }).code !== MAX_BUFFER_ERROR) throw err;
		return git(cwd, statusArgs("normal"));
	}
}

function toGroup(files: ScmFile[]): ScmGroup {
	return { total: files.length, files: files.slice(0, SCM_GROUP_LIMIT) };
}

const EMPTY_GROUP: ScmGroup = { total: 0, files: [] };

async function readCheckout(
	entry: WorktreeEntry,
	isMain: boolean,
): Promise<ScmCheckout> {
	try {
		const parsed = parseStatusV2(await readStatus(entry.path));
		return {
			path: entry.path,
			isMain,
			branch: parsed.branch ?? entry.branch,
			head: parsed.head ?? entry.head,
			ok: true,
			merge: toGroup(parsed.merge),
			staged: toGroup(parsed.staged),
			changes: toGroup(parsed.changes),
		};
	} catch {
		return {
			path: entry.path,
			isMain,
			branch: entry.branch,
			head: entry.head,
			ok: false,
			merge: EMPTY_GROUP,
			staged: EMPTY_GROUP,
			changes: EMPTY_GROUP,
		};
	}
}

async function readCheckouts(entries: WorktreeEntry[]): Promise<ScmCheckout[]> {
	const results = new Array<ScmCheckout>(entries.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < entries.length) {
			const index = next++;
			results[index] = await readCheckout(entries[index], index === 0);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_PARALLEL_CHECKOUTS, entries.length) },
			worker,
		),
	);
	return results;
}

function isNotARepo(err: unknown): boolean {
	const stderr = (err as { stderr?: unknown }).stderr;
	return (
		typeof stderr === "string" &&
		stderr.toLowerCase().includes("not a git repository")
	);
}

async function buildSnapshot(rootCwd: string): Promise<ScmSnapshot> {
	let entries: WorktreeEntry[];
	try {
		entries = parseWorktreeList(
			await git(rootCwd, ["worktree", "list", "--porcelain", "-z"]),
		);
	} catch (err) {
		return { ok: false, reason: isNotARepo(err) ? "not-a-repo" : "failed" };
	}
	if (entries.length === 0) return { ok: false, reason: "not-a-repo" };
	try {
		const checkouts = await readCheckouts(entries);
		return { ok: true, fetchedAt: Date.now(), checkouts };
	} catch {
		return { ok: false, reason: "failed" };
	}
}

export function getSnapshot(rootCwd: string): Promise<ScmSnapshot> {
	const existing = inFlight.get(rootCwd);
	if (existing) return existing;
	const pending = buildSnapshot(rootCwd)
		.catch((): ScmSnapshot => ({ ok: false, reason: "failed" }))
		.finally(() => {
			inFlight.delete(rootCwd);
		});
	inFlight.set(rootCwd, pending);
	return pending;
}
