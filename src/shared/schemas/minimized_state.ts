import { z } from "zod";

/**
 * Per-session "permission cards minimized" flag. When `true`, the inline
 * pending-permission section in the sessions-list row is hidden — only the
 * `awaiting_permission` status pill and the row's accent treatment remain.
 *
 * Persisted in the main process (file-backed JSON) so the choice survives
 * app restarts, and broadcast to every window via `state:changed` so multi-
 * window setups stay consistent. Mirrors the `read_state` model exactly.
 */
export const MinimizedStateFileSchema = z.object({
	minimized: z.record(z.string(), z.boolean()),
});
export type MinimizedStateFile = z.infer<typeof MinimizedStateFileSchema>;
