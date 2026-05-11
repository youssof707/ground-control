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
	sessionsSidebarWidth: sidebarWidth(200, 800),
	notesSidebarWidth: sidebarWidth(280, 900),
});
export type AppSettingsFile = z.infer<typeof AppSettingsFileSchema>;
