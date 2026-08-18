import { z } from "zod";
import { StoredWorktreeColorSchema, WorktreeColorSchema } from "./worktrees";

/**
 * Sidebar session group — a purely organizational bucket, Chrome-tab-group
 * style. Unlike worktrees there is no on-disk resource behind a group, so
 * there's no reverse index (`sessionIds`) here: membership lives solely on
 * `ClaudeSession.groupId` and emptiness is computed by scanning the session
 * store. Groups auto-delete the moment their last member leaves (removed,
 * archived, or deleted).
 *
 * `color` reuses the worktree palette so both features draw from the same
 * two design tokens (info/danger).
 *
 * `collapsed` is persisted on the record (not per-window UI state) so a
 * collapse survives restarts and syncs across windows via `state:changed`.
 */
export const SessionGroupSchema = z.object({
	id: z.string(),
	name: z.string(),
	color: StoredWorktreeColorSchema,
	/** Drives sidebar ordering: newest group first, under ungrouped rows. */
	createdAt: z.number(),
	collapsed: z.boolean().default(false),
});
export type SessionGroup = z.infer<typeof SessionGroupSchema>;

export const SessionGroupsFileSchema = z.object({
	items: z.record(z.string(), SessionGroupSchema),
});
export type SessionGroupsFile = z.infer<typeof SessionGroupsFileSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────

export const CreateSessionGroupInputSchema = z.object({
	name: z.string(),
	color: WorktreeColorSchema,
});
export type CreateSessionGroupInput = z.infer<
	typeof CreateSessionGroupInputSchema
>;
