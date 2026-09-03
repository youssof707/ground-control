import { z } from "zod";

/**
 * App-wide user preferences. Lives in the main process (file-backed JSON) so
 * every renderer window sees the same value after a `state:changed` ping
 * triggers a refetch.
 */

/**
 * Sidebar widths are persisted as ints, but pointer events on high-DPI
 * displays report fractional `clientX` values — so older builds could write
 * floats like `500.2734375` to disk. Preprocess rounds any incoming number
 * before the int check, so legacy files still load cleanly.
 */
const sidebarWidth = (min: number, max: number) =>
	z
		.preprocess(
			(v) => (typeof v === "number" ? Math.round(v) : v),
			z.number().int().min(min).max(max),
		)
		.optional();

export const AppSettingsFileSchema = z.object({
	lastUsedWorkspace: z.string().optional(),
	/**
	 * App-wide default model for brand-new sessions. Same string space as
	 * `ClaudeSession.model`: the CLI's own id or alias, verbatim ("sonnet",
	 * "sonnet[1m]", "claude-sonnet-4-5-20250929"). Deliberately unvalidated
	 * beyond non-empty — which ids are legal is a property of the user's
	 * binary AND their account, so the only honest validator is the CLI
	 * itself (see SessionManager's model-rejection fallback). `min(1)` only
	 * guards a hand-edited "" becoming a poison `--model ""`.
	 *
	 * Absent = no app default; new sessions omit the `model` key entirely
	 * and the CLI resolves its own default — the pre-existing behaviour.
	 */
	defaultModel: z.string().min(1).optional(),
	/**
	 * cwd → id of the worktree a session was last started on in that
	 * workspace. Read by the ⌘N / "New Session" path to pre-attach the
	 * worktree you were last working in, so returning to a repo resumes on
	 * the same branch checkout instead of the bare base dir.
	 *
	 * Keyed per workspace rather than as a single global "last worktree"
	 * because a worktree is bound to a `baseDir`: `session:start` drops any
	 * `worktreeId` whose `wt.baseDir !== cwd`, so one global value would be
	 * silently discarded the moment you switch repos.
	 *
	 * Entries are written (and cleared, by starting a plain non-worktree
	 * session in the same folder) at draft→real promotion. Never pruned on
	 * worktree deletion — readers re-validate against the live worktree list
	 * instead, since this file has no visibility into worktree lifecycle.
	 */
	lastUsedWorktreeByWorkspace: z.record(z.string(), z.string()).optional(),
	sessionsSidebarWidth: sidebarWidth(200, 800),
	notesSidebarWidth: sidebarWidth(280, 900),
	sidequestSidebarWidth: sidebarWidth(280, 900),
});
export type AppSettingsFile = z.infer<typeof AppSettingsFileSchema>;
