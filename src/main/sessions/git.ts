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
