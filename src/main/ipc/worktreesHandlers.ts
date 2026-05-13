import { ipcMain } from "electron";
import * as worktreeStore from "../core/store/worktrees";
import { assertGitRepo, getDefaultBaseRef, getRepoToplevel } from "../sessions/worktree";
import type {
	ListWorktreesForSessionResult,
	Worktree,
} from "../../shared/schemas/worktree";

/**
 * Worktree-side IPC handlers.
 *
 * In the ephemeral-draft model (see plan), worktree creation no longer
 * happens via its own IPC — it's folded into `session:start` so the SDK
 * loop is spawned exactly once with the final cwd (the worktree path).
 * This file is left with the read-only IPCs the renderer needs to
 * populate the link modal (list / peek-base-ref) and hydrate the global
 * worktrees cache on boot.
 *
 * The signatures take a raw `cwd` (the source-repo folder the user
 * picked) instead of a `sessionId`, because the renderer calls them
 * while still inside an ephemeral draft — there is no backend session
 * record yet.
 */
export function registerWorktreesHandlers(): void {
	/**
	 * List worktrees scoped to a given source folder's repo. The link
	 * modal uses this to populate its "or link existing" rows. Resolves
	 * the picked folder to a repo toplevel (so subdir paths into the
	 * same repo collapse), then filters `worktreeStore` by canonicalized
	 * `originalCwd`. Returns the empty list with `notARepo: true` when
	 * `cwd` isn't inside a git working tree — the modal uses this to
	 * disable the Create form with a clear hint.
	 */
	ipcMain.handle(
		"worktrees:listForCwd",
		async (
			_e,
			cwd: string,
		): Promise<ListWorktreesForSessionResult> => {
			let repoToplevel: string;
			try {
				await assertGitRepo(cwd);
				repoToplevel = await getRepoToplevel(cwd);
			} catch {
				return { items: [], repoToplevel: null, notARepo: true };
			}
			const items = worktreeStore.listForRepo(repoToplevel);
			return { items, repoToplevel, notARepo: false };
		},
	);

	/**
	 * Lightweight read-only echo: the default base ref that
	 * `session:start({ worktree: { kind: "new" } })` would use for this
	 * folder's repo. The link modal calls this to show the user what
	 * they'd branch off before they commit to a name. Returns null on
	 * failure (not a repo, no origin/HEAD, no main/master) — the modal
	 * renders "(unknown)".
	 */
	ipcMain.handle(
		"worktrees:peekBaseRefForCwd",
		async (_e, cwd: string): Promise<string | null> => {
			try {
				await assertGitRepo(cwd);
				return await getDefaultBaseRef(cwd);
			} catch {
				return null;
			}
		},
	);

	/**
	 * Bulk dump of every worktree the app knows about. Hydrates the
	 * renderer's worktree cache at boot and on every `state:changed`
	 * ping; downstream UI (the locked info chip, the sidebar row's
	 * displayCwd resolution) reads from that cache without making
	 * per-session IPC calls.
	 */
	ipcMain.handle("worktrees:list", async (): Promise<Worktree[]> => {
		return worktreeStore.listWorktrees();
	});
}
