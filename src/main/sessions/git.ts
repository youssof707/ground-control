import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd },
		);
		const branch = stdout.trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

export async function getHeadCommit(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "HEAD"],
			{ cwd },
		);
		const sha = stdout.trim();
		return sha || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Best-effort detection of the project's default base branch (typically
 * `main` or `master`). Used to seed `lastUserMessageBranch` on brand-new
 * sessions so the staleness chip fires immediately if the user creates a
 * session while sitting on a feature branch — without having to wait for
 * the first message.
 *
 * Strategy:
 *   1. `git symbolic-ref --short refs/remotes/origin/HEAD` — this is what
 *      origin advertises as its default branch. `git clone` sets it
 *      locally, so it works offline.
 *   2. Fallback: local `refs/heads/main`.
 *   3. Fallback: local `refs/heads/master`.
 *   4. Otherwise undefined.
 *
 * Shell-free (`execFile`) and swallows errors — callers treat `undefined`
 * the same as "no baseline available", so the chip simply doesn't fire.
 */
export async function getDefaultBaseBranch(
	cwd: string,
): Promise<string | undefined> {
	// 1. origin's advertised HEAD (e.g. "origin/main").
	try {
		const { stdout } = await execFileAsync(
			"git",
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ cwd },
		);
		const name = stdout.trim();
		if (name.startsWith("origin/")) {
			const stripped = name.slice("origin/".length);
			if (stripped) return stripped;
		} else if (name) {
			return name;
		}
	} catch {
		// fall through to local fallbacks
	}
	// 2 + 3. Local main / master.
	for (const candidate of ["main", "master"]) {
		try {
			await execFileAsync(
				"git",
				["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`],
				{ cwd },
			);
			return candidate;
		} catch {
			// try next
		}
	}
	return undefined;
}

/**
 * Run `git switch <branch>` in the given cwd. Unlike the read-only helpers
 * above this one *throws* on failure — the caller wants the error so it can
 * surface "branch doesn't exist", "uncommitted changes would be lost", etc.
 * to the user. `execFile` (not `exec`) is shell-free, so the branch name
 * can't break out into a shell command — but we still reject leading `-` so
 * a malicious value can't be interpreted as a git flag.
 */
export async function switchBranch(
	cwd: string,
	branch: string,
): Promise<void> {
	if (!branch || branch.startsWith("-")) {
		throw new Error(`Invalid branch name: ${branch}`);
	}
	try {
		await execFileAsync("git", ["switch", branch], { cwd });
	} catch (err) {
		// `execFile`'s rejection has the full stderr in `err.stderr` — that's
		// the actually useful message (e.g. "Your local changes would be
		// overwritten…"). Surface it instead of the generic "Command failed".
		const stderr =
			(err as { stderr?: string }).stderr?.toString().trim() || "";
		const message = stderr || (err as Error).message;
		throw new Error(message);
	}
}

export async function getDiffSinceCommit(
	cwd: string,
	sha: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", sha],
			{ cwd, maxBuffer: 64 * 1024 * 1024 },
		);
		return stdout || "";
	} catch {
		return undefined;
	}
}
