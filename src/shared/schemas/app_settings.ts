import { z } from "zod";

/**
 * App-wide user preferences. Lives in the main process (file-backed JSON) so
 * every renderer window sees the same value after a `state:changed` ping
 * triggers a refetch.
 */
export const AppSettingsFileSchema = z.object({
	lastUsedWorkspace: z.string().optional(),
	sessionsSidebarWidth: z.number().int().min(200).max(800).optional(),
});
export type AppSettingsFile = z.infer<typeof AppSettingsFileSchema>;
