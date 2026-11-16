import { promises as fs } from "node:fs";
import type { ScmAction } from "../../shared/schemas/source_control";
import { checkoutPath } from "./content";
import { runGit } from "./gitProcess";
import type { StatusEntry } from "./parseStatus";

export interface ApplyTarget {
	root: string;
	unborn: boolean;
	staged: StatusEntry[] | "all";
	unstaged: StatusEntry[] | "all";
	allEntries: StatusEntry[];
}

export class ApplyError extends Error {}

const PATHSPEC_FROM_STDIN = ["--pathspec-from-file=-", "--pathspec-file-nul"];

function isNestedRepo(entry: StatusEntry): boolean {
	return entry.path.endsWith("/");
}

function pathspecInput(entries: StatusEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		parts.push(entry.raw ?? Buffer.from(entry.path, "utf8"), Buffer.from([0]));
	}
	return Buffer.concat(parts);
}

async function git(root: string, args: string[], input?: Buffer): Promise<void> {
	const result = await runGit({ cwd: root, args, input });
	if (result.code !== 0) {
		throw new ApplyError(result.stderr.trim().split("\n").pop() || `git ${args[0]} failed`);
	}
}

async function gitPaths(root: string, args: string[], entries: StatusEntry[]): Promise<void> {
	if (entries.length === 0) return;
	await git(root, ["--literal-pathspecs", ...args, ...PATHSPEC_FROM_STDIN], pathspecInput(entries));
}

function dedupe(entries: StatusEntry[]): StatusEntry[] {
	const seen = new Set<string>();
	const out: StatusEntry[] = [];
	for (const entry of entries) {
		if (seen.has(entry.path)) continue;
		seen.add(entry.path);
		out.push(entry);
	}
	return out;
}

function resolve(pick: StatusEntry[] | "all", staged: boolean, all: StatusEntry[]): StatusEntry[] {
	if (pick !== "all") return pick;
	return all.filter((entry) => entry.staged === staged);
}

async function stage(target: ApplyTarget): Promise<void> {
	if (target.unstaged === "all") {
		await git(target.root, ["add", "-A"]);
		return;
	}
	await gitPaths(target.root, ["add", "-A"], target.unstaged.filter((e) => !isNestedRepo(e)));
}

async function unstage(target: ApplyTarget): Promise<void> {
	if (target.staged === "all") {
		if (target.unborn) await git(target.root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", "."]);
		else await git(target.root, ["reset", "-q"]);
		return;
	}
	if (target.unborn) {
		await gitPaths(target.root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch"], target.staged);
	} else {
		await gitPaths(target.root, ["reset", "-q"], target.staged);
	}
}

async function removeFiles(root: string, entries: StatusEntry[]): Promise<void> {
	for (const entry of entries) {
		await fs.rm(checkoutPath(root, entry), { force: true });
	}
}

async function discard(target: ApplyTarget): Promise<void> {
	const { root, unborn } = target;
	if (target.staged === "all" && target.unstaged === "all") {
		if (unborn) await git(root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", "."]);
		else await git(root, ["reset", "--hard", "-q"]);
		await git(root, ["clean", "-f", "-d", "-q"]);
		return;
	}

	const staged = resolve(target.staged, true, target.allEntries);
	const unstaged = resolve(target.unstaged, false, target.allEntries);
	const toHead = dedupe([...staged, ...unstaged.filter((e) => e.status === "C")]);
	const headPaths = new Set(toHead.map((e) => e.path));
	const toIndex = dedupe(
		unstaged.filter((e) => e.status !== "C" && e.status !== "U" && !headPaths.has(e.path)),
	);
	const untracked = unstaged.filter((e) => e.status === "U" && !isNestedRepo(e));

	if (unborn) await gitPaths(root, ["rm", "-r", "-f", "-q", "--ignore-unmatch"], toHead);
	else await gitPaths(root, ["restore", "--source=HEAD", "--staged", "--worktree"], toHead);

	if (target.unstaged === "all" && toIndex.length > 0) {
		await git(root, ["restore", "--worktree", "--ignore-unmerged", "--", "."]);
	} else {
		await gitPaths(root, ["restore", "--worktree", "--ignore-unmerged"], toIndex);
	}

	if (target.unstaged === "all") await git(root, ["clean", "-f", "-d", "-q"]);
	else await removeFiles(root, untracked);
}

export async function applyAction(action: ScmAction, target: ApplyTarget): Promise<void> {
	if (action === "stage") return stage(target);
	if (action === "unstage") return unstage(target);
	return discard(target);
}
