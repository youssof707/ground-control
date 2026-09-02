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
	sessionsSidebarWidth: sidebarWidth(200, 800),
	notesSidebarWidth: sidebarWidth(280, 900),
	sidequestSidebarWidth: sidebarWidth(280, 900),
});
export type AppSettingsFile = z.infer<typeof AppSettingsFileSchema>;
