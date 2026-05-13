import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Throws a user-facing error if `cwd` isn't inside a git working tree.
 * Used to fail fast in the link modal before we try to create a worktree.
 */
export async function assertGitRepo(cwd: string): Promise<void> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--is-inside-work-tree"],
			{ cwd },
		);
		if (stdout.trim() !== "true") {
			throw new Error("Not a git repository");
		}
	} catch (err) {
		const stderr =
			(err as { stderr?: string }).stderr?.toString().trim() || "";
		const msg = stderr || (err as Error).message || "Not a git repository";
		throw new Error(msg);
	}
}

/**
 * Returns the repo's toplevel directory (via `git rev-parse --show-toplevel`).
 * Used to canonicalize `originalCwd` so two paths into the same repo collapse
 * to the same key when matching worktrees to the current session's repo.
 *
 * Throws on failure — caller can fall back to assertGitRepo to surface a
 * better error.
 */
export async function getRepoToplevel(cwd: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["rev-parse", "--show-toplevel"],
		{ cwd },
	);
	const top = stdout.trim();
	if (!top) throw new Error("Could not resolve repository toplevel");
	return top;
}

/**
 * Resolve the ref to branch the new worktree off:
 *   1. `git symbolic-ref --short refs/remotes/origin/HEAD` → e.g. "origin/main"
 *   2. fallback: local `main`
 *   3. fallback: local `master`
 *   4. otherwise throws (no sensible default to branch off)
 *
 * Sister of `getDefaultBaseBranch` in git.ts (which returns the short name);
 * this returns the qualified ref usable as the start-point argument to
 * `git worktree add -b <branch> <path> <ref>`.
 */
export async function getDefaultBaseRef(cwd: string): Promise<string> {
	// 1. origin's advertised HEAD.
	try {
		const { stdout } = await execFileAsync(
			"git",
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ cwd },
		);
		const ref = stdout.trim();
		if (ref) return ref; // already qualified, e.g. "origin/main"
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
	throw new Error(
		"Couldn't find a default base branch (no origin/HEAD, no local main, no local master).",
	);
}

/**
 * Validate that `branch` is a safe, non-existent branch name in the source
 * repo. Throws with a user-friendly message on failure:
 *   - leading "-" (would look like a git flag)
 *   - empty / whitespace
 *   - illegal characters (git's own ref-format rules)
 *   - branch already exists locally
 *
 * Always called before the `git worktree add -b` shell-out so we can show
 * the user a clear error without leaving partial state on disk.
 */
export async function assertBranchCanBeCreated(
	originalCwd: string,
	branch: string,
): Promise<void> {
	if (!branch || branch.trim() !== branch || branch.length === 0) {
		throw new Error("Branch name is empty.");
	}
	if (branch.startsWith("-")) {
		throw new Error("Branch name can't start with a dash.");
	}
	if (branch.includes("..")) {
		throw new Error("Branch name can't contain '..'.");
	}
	// `git check-ref-format --branch <name>` returns non-zero for any
	// rule-breaking name. Catches whitespace, ~, ^, :, ?, *, [, \, etc.
	try {
		await execFileAsync(
			"git",
			["check-ref-format", "--branch", branch],
			{ cwd: originalCwd },
		);
	} catch {
		throw new Error(`"${branch}" isn't a valid git branch name.`);
	}
	// Reject duplicates so the `git worktree add -b` doesn't error out
	// later with a less obvious message.
	try {
		await execFileAsync(
			"git",
			["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
			{ cwd: originalCwd },
		);
		// rev-parse succeeded → branch already exists.
		throw new Error(`Branch "${branch}" already exists in this repo.`);
	} catch (err) {
		// We only want to swallow the "branch doesn't exist" case (exit code
		// non-zero from rev-parse). The collision case re-throws our own
		// Error from above; let it propagate.
		if ((err as Error).message?.startsWith("Branch ")) throw err;
		// otherwise: branch doesn't exist — good, that's what we want.
	}
}

/**
 * Deterministic path on disk for a given worktree id. Kept separate from
 * the store / the git fn so the IPC handler can compute the path before
 * committing to the create.
 */
export function worktreePathFor(dataDir: string, worktreeId: string): string {
	return path.join(dataDir, "worktrees", worktreeId);
}

/**
 * Run `git worktree add -b <branch> <targetPath> <baseRef>` from
 * `originalCwd`. On failure, best-effort `rm -rf` of the target path so a
 * partial directory can't leak, then rethrow with git's stderr surfaced.
 *
 * Note: `git worktree add` only writes to `.git/worktrees/<name>/` (admin
 * metadata) and the target path itself. It does NOT touch the source
 * repo's working tree, HEAD, or index — so the user's editor session
 * against the source repo is unaffected.
 */
export async function gitWorktreeAdd(args: {
	originalCwd: string;
	targetPath: string;
	branch: string;
	baseRef: string;
}): Promise<void> {
	const { originalCwd, targetPath, branch, baseRef } = args;
	// Make sure the parent directory exists. `git worktree add` requires the
	// target itself to be absent, but the parent must exist.
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	try {
		await execFileAsync(
			"git",
			["worktree", "add", "-b", branch, targetPath, baseRef],
			{ cwd: originalCwd },
		);
	} catch (err) {
		// Best-effort rollback. `git worktree add` is mostly atomic — it
		// either creates the target dir + branch ref or neither — but if a
		// stale directory ends up on disk we want it gone before we throw.
		try {
			await fs.rm(targetPath, { recursive: true, force: true });
		} catch {
			// Swallow: the rethrow below is the actionable error.
		}
		const stderr =
			(err as { stderr?: string }).stderr?.toString().trim() || "";
		const message = stderr || (err as Error).message || "git worktree add failed";
		throw new Error(message);
	}
}

/**
 * Best-effort existence check for a worktree directory. Used by
 * SessionManager.resume to detect a worktree that was nuked externally
 * between app launches.
 */
export async function worktreeDirExists(p: string): Promise<boolean> {
	try {
		const stat = await fs.stat(p);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Tear down a worktree fully:
 *   1. `git worktree remove <path>` from originalCwd (clean removal)
 *   2. on failure, `--force` (handles uncommitted changes)
 *   3. on failure, `git worktree prune` + `rm -rf <path>` (last-resort
 *      when git itself can't follow through — orphans the admin metadata,
 *      but the next `prune` cleans that up)
 *   4. delete the worktree's branch with `git branch -D` from originalCwd
 *
 * Each step is best-effort with its own try/catch — the caller (session
 * delete IPC) needs deletion to always converge so the user isn't left
 * with a half-removed record. Errors are logged but not rethrown.
 *
 * Like `gitWorktreeAdd`, this only touches `.git/worktrees/<name>/` admin
 * metadata + the worktree's working directory + the branch ref. It never
 * modifies the source repo's working tree / HEAD / index — VS Code on the
 * source repo stays unaffected.
 */
export async function destroyWorktree(args: {
	originalCwd: string;
	targetPath: string;
	branch: string;
}): Promise<void> {
	const { originalCwd, targetPath, branch } = args;

	// Phase 1: try the clean path. Fails on dirty working trees.
	let removed = false;
	try {
		await execFileAsync(
			"git",
			["worktree", "remove", targetPath],
			{ cwd: originalCwd },
		);
		removed = true;
	} catch (err) {
		console.warn(
			`[ccw] git worktree remove failed for ${targetPath}, retrying with --force:`,
			(err as Error).message,
		);
	}

	// Phase 2: force the removal. Handles uncommitted changes.
	if (!removed) {
		try {
			await execFileAsync(
				"git",
				["worktree", "remove", "--force", targetPath],
				{ cwd: originalCwd },
			);
			removed = true;
		} catch (err) {
			console.warn(
				`[ccw] git worktree remove --force failed for ${targetPath}, falling back to rm -rf:`,
				(err as Error).message,
			);
		}
	}

	// Phase 3: brute-force cleanup. Prune git's admin metadata then nuke
	// the directory. This path runs only if both git removals above
	// failed (e.g. git is unhappy with the admin state) — `prune` re-
	// canonicalizes the worktree list so the next op succeeds, and the
	// rm -rf guarantees the directory is gone from the user's PoV.
	if (!removed) {
		try {
			await execFileAsync(
				"git",
				["worktree", "prune"],
				{ cwd: originalCwd },
			);
		} catch (err) {
			console.warn(
				"[ccw] git worktree prune failed (non-fatal):",
				(err as Error).message,
			);
		}
		try {
			await fs.rm(targetPath, { recursive: true, force: true });
		} catch (err) {
			console.warn(
				`[ccw] rm -rf of worktree directory failed: ${targetPath}`,
				(err as Error).message,
			);
		}
	}

	// Phase 4: delete the branch. After `git worktree remove`, the branch
	// is no longer checked out anywhere, so `-D` succeeds even if it has
	// unmerged commits (which is exactly what the user wants — they
	// explicitly opted into removing the worktree). If the branch was
	// already deleted out-of-band, the error is harmless.
	try {
		await execFileAsync(
			"git",
			["branch", "-D", branch],
			{ cwd: originalCwd },
		);
	} catch (err) {
		console.warn(
			`[ccw] git branch -D ${branch} failed (non-fatal):`,
			(err as Error).message,
		);
	}
}
