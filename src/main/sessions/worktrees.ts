import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * App-owned git worktree operations. Sibling of `git.ts` — same
 * shell-free `execFile` pattern, same "throw stderr on failure so the
 * caller can surface it to the user" convention as `switchBranch`.
 *
 * The registry / metadata layer lives in `../core/store/worktrees`.
 * This file only wraps the `git worktree` sub-commands.
 */

function assertSafeBranch(branch: string): void {
	if (!branch || branch.startsWith("-")) {
		throw new Error(`Invalid branch name: ${branch}`);
	}
}

function assertSafePath(p: string): void {
	if (!p || p.startsWith("-")) {
		throw new Error(`Invalid path: ${p}`);
	}
}

/**
 * Cheap check: is `baseDir` inside a git working tree? Used by the
 * renderer to gate the "Add worktree" affordance — if the user's draft
 * folder isn't a git repo, worktrees don't apply, and we hide the button
 * entirely.
 *
 * Uses `rev-parse --is-inside-work-tree`, which is the standard
 * lightweight probe. Swallows all errors (missing git, not a repo,
 * unreadable path) → false.
 */
export async function isGitRepo(baseDir: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--is-inside-work-tree"],
			{ cwd: baseDir },
		);
		return stdout.trim() === "true";
	} catch {
		return false;
	}
}

/**
 * Two-mode worktree creation:
 *
 *   - `{ mode: "new", name }` runs `git worktree add -b <name> <path>`,
 *     branching off whatever HEAD `baseDir` is at right now — matching the
 *     original user-agreed strategy.
 *
 *   - `{ mode: "existing", name }` runs `git worktree add <path> <name>`,
 *     checking out an already-existing branch. Git rejects with "already
 *     used by worktree at …" if the branch is currently checked out
 *     anywhere; the renderer pre-filters those cases via `listLocalBranches`
 *     but we let git be the ground truth.
 *
 * Throws with git's stderr on failure so the modal can render it inline.
 * The caller (worktreesHandlers.create) is responsible for only writing
 * the registry entry AFTER this resolves successfully.
 */
export async function worktreeAdd(input: {
	baseDir: string;
	worktreePath: string;
	branch: { mode: "new"; name: string } | { mode: "existing"; name: string };
}): Promise<void> {
	assertSafeBranch(input.branch.name);
	assertSafePath(input.worktreePath);
	const args =
		input.branch.mode === "new"
			? ["worktree", "add", "-b", input.branch.name, input.worktreePath]
			: ["worktree", "add", input.worktreePath, input.branch.name];
	try {
		await execFileAsync("git", args, { cwd: input.baseDir });
	} catch (err) {
		const stderr =
			(err as { stderr?: string }).stderr?.toString().trim() || "";
		const message = stderr || (err as Error).message;
		throw new Error(message);
	}
}

/**
 * List local branches in `baseDir` along with the worktree that currently
 * has each branch checked out (if any). Used by the modal's "Existing
 * branch" mode: rows whose `worktreePath` is non-null are shown disabled
 * with a hint pointing at the occupying checkout, since `git worktree add`
 * refuses to reuse an already-checked-out branch.
 *
 * Uses `for-each-ref` with a machine-readable format: `%(refname:short)`
 * is the branch name (e.g. `feat/foo`), `%(worktreepath)` is the absolute
 * path of the worktree that checks it out (empty if none). Tab is the
 * separator — it's the one char that can't appear in either field, so no
 * escaping needed.
 *
 * Returns `[]` on any error (not a repo, git missing, etc.) — callers
 * treat that the same as "no branches", which lets the modal render a
 * useful empty state without needing to distinguish failure modes.
 */
export async function listLocalBranches(
	baseDir: string,
): Promise<{ name: string; worktreePath: string | null }[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			[
				"for-each-ref",
				"--format=%(refname:short)\t%(worktreepath)",
				"refs/heads/",
			],
			{ cwd: baseDir },
		);
		return stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter((line) => line.length > 0)
			.map((line) => {
				const tab = line.indexOf("\t");
				const name = tab === -1 ? line : line.slice(0, tab);
				const wtPath = tab === -1 ? "" : line.slice(tab + 1);
				return { name, worktreePath: wtPath || null };
			});
	} catch {
		return [];
	}
}

/**
 * Best-effort teardown of a checkout. Tries a clean `git worktree remove`
 * first; on failure (dirty working tree, missing dir, etc.) escalates to
 * `--force`, then runs `git worktree prune` to clean out any dangling
 * administrative entries. Finally rm -rf's the directory if it's still
 * hanging around — since it lives entirely under the app's data dir, we
 * own it and can nuke it.
 *
 * Swallows all errors after the escalation ladder — the caller (delete
 * handler) needs the registry entry gone regardless of whether git
 * cooperated. If the on-disk state is inconsistent, `prune` on the next
 * `worktreeAdd` in the same repo will straighten things out.
 */
export async function worktreeRemove(input: {
	baseDir: string;
	worktreePath: string;
}): Promise<void> {
	assertSafePath(input.worktreePath);
	try {
		await execFileAsync(
			"git",
			["worktree", "remove", input.worktreePath],
			{ cwd: input.baseDir },
		);
	} catch {
		try {
			await execFileAsync(
				"git",
				["worktree", "remove", "--force", input.worktreePath],
				{ cwd: input.baseDir },
			);
		} catch {
			// keep going — we still want to prune + rm below
		}
	}
	try {
		await execFileAsync("git", ["worktree", "prune"], { cwd: input.baseDir });
	} catch {
		// non-fatal
	}
	// Nuke the physical directory if it's still there — we own it.
	try {
		await fs.rm(input.worktreePath, { recursive: true, force: true });
	} catch {
		// non-fatal
	}
}
