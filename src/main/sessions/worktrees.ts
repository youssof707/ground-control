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

export type WorktreeRemoveStep =
	| "remove"
	| "unlock"
	| "remove-force"
	| "remove-force-force"
	| "fs-rm"
	| "prune";

export type WorktreeRemoveResult = {
	/** Path is gone from disk — the caller can drop the registry entry. */
	ok: boolean;
	/** True if `worktreePath` still exists after the escalation ladder. */
	pathStillExists: boolean;
	/** Per-step failures in the order they were attempted. Populated even
	 * on `ok: true` if an earlier tier failed and a later one recovered. */
	errors: { step: WorktreeRemoveStep; message: string }[];
};

/**
 * Pull git's real complaint out of an `execFile` rejection. Matches the
 * pattern used by `switchBranch` in `./git.ts` — the useful message lives
 * in `err.stderr`, not in the generic Node `Error.message`.
 */
function extractStderr(err: unknown): string {
	const stderr = (err as { stderr?: string }).stderr?.toString().trim() || "";
	return stderr || (err as Error).message || String(err);
}

/**
 * Teardown of a checkout. Escalation ladder:
 *
 *   1. `git worktree remove <path>` — clean case.
 *   2. `git worktree unlock <path>` — best-effort; some worktrees get
 *      locked (e.g. by the user via CLI). Ignore "not locked" stderr.
 *   3. `git worktree remove --force <path>` — handles dirty working tree.
 *   4. `git worktree remove --force --force <path>` — handles locked
 *      worktrees on git versions that need double-force.
 *   5. `fs.rm(<path>)` — nuke the physical dir. Runs BEFORE prune so that
 *      prune sees the missing dir and cleans the `.git/worktrees/<name>/`
 *      admin entry.
 *   6. `git worktree prune` — cleans any leftover admin entries.
 *   7. `fs.stat` verification — sets `ok` / `pathStillExists`.
 *
 * Unlike the previous version, this DOES NOT swallow errors — it collects
 * them in `errors[]` and returns a structured result so the IPC handler
 * can decide whether to preserve the registry entry for user retry.
 */
export async function worktreeRemove(input: {
	baseDir: string;
	worktreePath: string;
}): Promise<WorktreeRemoveResult> {
	assertSafePath(input.worktreePath);
	const errors: { step: WorktreeRemoveStep; message: string }[] = [];

	// Tier 1: clean remove.
	let cleanedByGit = false;
	try {
		await execFileAsync(
			"git",
			["worktree", "remove", input.worktreePath],
			{ cwd: input.baseDir },
		);
		cleanedByGit = true;
	} catch (err) {
		errors.push({ step: "remove", message: extractStderr(err) });
	}

	// Tier 2: unlock (idempotent — "not locked" is fine).
	if (!cleanedByGit) {
		try {
			await execFileAsync(
				"git",
				["worktree", "unlock", input.worktreePath],
				{ cwd: input.baseDir },
			);
		} catch (err) {
			const message = extractStderr(err);
			// Not-locked is the happy case for unlock; don't count as a failure.
			if (!/not locked/i.test(message)) {
				errors.push({ step: "unlock", message });
			}
		}
	}

	// Tier 3: --force.
	if (!cleanedByGit) {
		try {
			await execFileAsync(
				"git",
				["worktree", "remove", "--force", input.worktreePath],
				{ cwd: input.baseDir },
			);
			cleanedByGit = true;
		} catch (err) {
			errors.push({ step: "remove-force", message: extractStderr(err) });
		}
	}

	// Tier 4: --force --force (older/newer git combos, locked edge cases).
	if (!cleanedByGit) {
		try {
			await execFileAsync(
				"git",
				["worktree", "remove", "--force", "--force", input.worktreePath],
				{ cwd: input.baseDir },
			);
			cleanedByGit = true;
		} catch (err) {
			errors.push({ step: "remove-force-force", message: extractStderr(err) });
		}
	}

	// Tier 5: fs.rm. Runs regardless — `git worktree remove` may have left
	// the directory behind on partial failure, and we own everything under
	// the worktrees root so nuking is safe.
	try {
		await fs.rm(input.worktreePath, { recursive: true, force: true });
	} catch (err) {
		errors.push({ step: "fs-rm", message: extractStderr(err) });
	}

	// Tier 6: prune — now that the dir is (hopefully) gone, prune cleans
	// the admin entry at `.git/worktrees/<name>/`.
	try {
		await execFileAsync("git", ["worktree", "prune"], { cwd: input.baseDir });
	} catch (err) {
		errors.push({ step: "prune", message: extractStderr(err) });
	}

	// Verify.
	const pathStillExists = await fs.stat(input.worktreePath).then(
		() => true,
		() => false,
	);

	return {
		ok: !pathStillExists,
		pathStillExists,
		errors,
	};
}
