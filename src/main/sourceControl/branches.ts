import { basename } from "node:path";
import type { ScmBranch, ScmBranchList } from "../../shared/schemas/source_control";
import { isNotARepo, runGit } from "./gitProcess";

const LOCAL_PREFIX = "refs/heads/";
const REMOTE_PREFIX = "refs/remotes/";
const MAX_REF_OUTPUT = 64 * 1024 * 1024;

export class RepoError extends Error {
	constructor(
		readonly reason: "not-a-repo" | "failed",
		message: string,
	) {
		super(message);
	}
}

export interface RepoInfo {
	root: string;
	gitDir: string;
	worktreeName: string | null;
}

export function worktreeNameOf(gitDir: string, commonDir: string): string | null {
	const dir = gitDir.replace(/\/+$/, "");
	const common = commonDir.replace(/\/+$/, "");
	if (!dir || !common || dir === common) return null;
	return basename(dir) || null;
}

export async function readRepoInfo(checkout: string, signal: AbortSignal | undefined): Promise<RepoInfo> {
	const result = await runGit({
		cwd: checkout,
		args: ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
		signal,
		timeoutMs: 30_000,
	});
	if (result.code !== 0) {
		throw new RepoError(isNotARepo(result.stderr) ? "not-a-repo" : "failed", result.stderr.trim());
	}
	const [root = "", gitDir = "", commonDir = ""] = result.stdout.toString("utf8").split("\n");
	return { root: root || checkout, gitDir, worktreeName: worktreeNameOf(gitDir, commonDir) };
}

export function parseRefs(stdout: string): { current: string | null; branches: ScmBranch[] } {
	const local: ScmBranch[] = [];
	const remote: ScmBranch[] = [];
	const localNames = new Set<string>();
	let current: string | null = null;
	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const [ref = "", symref = "", date = "", worktree = "", head = ""] = line.split("\0");
		if (symref) continue;
		const seconds = Number.parseInt(date, 10);
		const when = Number.isFinite(seconds) ? seconds * 1000 : 0;
		if (ref.startsWith(LOCAL_PREFIX)) {
			const name = ref.slice(LOCAL_PREFIX.length);
			if (head === "*") current = name;
			localNames.add(name);
			local.push({ name, remote: null, date: when, worktree: worktree || null });
		} else if (ref.startsWith(REMOTE_PREFIX)) {
			const name = ref.slice(REMOTE_PREFIX.length);
			const slash = name.indexOf("/");
			if (slash <= 0 || slash === name.length - 1) continue;
			remote.push({ name, remote: name.slice(0, slash), date: when, worktree: null });
		}
	}
	const branches = local;
	for (const entry of remote) {
		const short = entry.name.slice((entry.remote?.length ?? 0) + 1);
		if (!localNames.has(short)) branches.push(entry);
	}
	return { current, branches };
}

export async function listBranches(checkout: string, signal: AbortSignal | undefined): Promise<ScmBranchList> {
	const [info, refs] = await Promise.all([
		readRepoInfo(checkout, signal),
		runGit({
			cwd: checkout,
			args: [
				"for-each-ref",
				"--sort=-committerdate",
				"--format=%(refname)%00%(symref)%00%(committerdate:unix)%00%(worktreepath)%00%(HEAD)",
				LOCAL_PREFIX,
				REMOTE_PREFIX,
			],
			signal,
			maxStdout: MAX_REF_OUTPUT,
		}),
	]);
	if (refs.code !== 0) {
		throw new RepoError(isNotARepo(refs.stderr) ? "not-a-repo" : "failed", refs.stderr.trim());
	}
	const { current, branches } = parseRefs(refs.stdout.toString("utf8"));
	return { current, worktreeName: info.worktreeName, branches, fetchedAt: Date.now() };
}

export function switchArgs(branch: string, remote: boolean, create = false): string[] {
	if (!branch || branch.startsWith("-") || /[\0\n]/.test(branch)) {
		throw new RepoError("failed", `Invalid branch name: ${branch}`);
	}
	if (create) return ["switch", "--no-track", "-c", branch];
	return remote ? ["switch", "--track", branch] : ["switch", "--no-guess", branch];
}

export async function switchBranch(
	checkout: string,
	branch: string,
	remote: boolean,
	create = false,
): Promise<void> {
	const result = await runGit({ cwd: checkout, args: switchArgs(branch, remote, create), timeoutMs: 10 * 60_000 });
	if (result.code !== 0) {
		throw new RepoError(isNotARepo(result.stderr) ? "not-a-repo" : "failed", result.stderr.trim() || "git switch failed");
	}
}
