import { z } from "zod";

/**
 * Per-session "last read at" timestamps. Source of truth for the unread badge.
 * Lives in the main process (file-backed JSON) so every renderer window sees
 * the same value after a `state:changed` ping triggers a refetch.
 */
export const ReadStateFileSchema = z.object({
	lastReadAt: z.record(z.string(), z.number()),
});
export type ReadStateFile = z.infer<typeof ReadStateFileSchema>;
