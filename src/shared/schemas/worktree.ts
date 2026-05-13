import { z } from "zod";

// ─── Worktree ──────────────────────────────────────────────────────────────
//
// App-owned git worktrees. Each record describes one worktree we created
// off some source repo at the user's request. Worktrees are first-class
// persistent entities: they outlive the sessions that may link to them.
// Sessions reference a worktree via `ClaudeSession.worktreeId`; from then
// on the session's `cwd` equals `worktree.path` and every SDK / git op
// runs inside the worktree.

export const WorktreeSchema = z.object({
	id: z.string(),
	/** Absolute path on disk: `<dataDir>/worktrees/<id>`. */
	path: z.string(),
	/** Branch name that was created when running `git worktree add -b`. */
	branch: z.string(),
	/** Ref the branch was created from (e.g. `origin/main`, `main`, `master`). */
	baseRef: z.string(),
	/** Source repo's toplevel — the directory we ran `git worktree add` in.
	 * Used to canonicalize "is this worktree for this session's repo?" and to
	 * route future cleanup operations back to the right repo. */
	originalCwd: z.string(),
	createdAt: z.number(),
});
export type Worktree = z.infer<typeof WorktreeSchema>;

export const WorktreesFileSchema = z.object({
	items: z.record(z.string(), WorktreeSchema),
});
export type WorktreesFile = z.infer<typeof WorktreesFileSchema>;

/**
 * Return shape of the `worktrees:listForSession` IPC. The link modal needs
 * three signals — the list itself, the resolved repo toplevel (so it can
 * tell the user *which* repo the empty list is for), and a flag for the
 * "session's folder isn't a git repo" case so it can disable creation
 * with a clear hint instead of triggering a server-side error mid-action.
 *
 * Defined in `shared/schemas` (not `preload/index.d.ts`) so both the main
 * IPC handler and the renderer can import it without going through the
 * preload barrel.
 */
export interface ListWorktreesForSessionResult {
	items: Worktree[];
	repoToplevel: string | null;
	notARepo: boolean;
}
