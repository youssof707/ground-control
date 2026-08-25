import { z } from "zod";
import { SessionModeSchema } from "./claude_session";

/**
 * Saved prompt shortcut — a reusable prompt for the session you're
 * *already in*. Picking one from the composer's shortcuts menu appends its
 * text to the current draft and flips the session's Plan / Auto-edit mode.
 *
 * Deliberately separate from `shortcuts.ts`: those carry a `cwd` and spawn
 * a brand-new draft session from the sidebar. The two lists never mix.
 *
 * `title` is required (unlike a session shortcut, there is no `cwd` to fall
 * back on for a menu label) — but only on the *input* schemas. This schema
 * is what `PromptShortcutsFileSchema.parse` runs against at boot, and a
 * parse failure there hits the `app.exit(1)` branch in main/index.ts. A
 * hand-edited or legacy blank title must not brick startup, so reads stay
 * permissive and the renderer falls back to a prompt preview.
 */
export const PromptShortcutSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	mode: SessionModeSchema,
	createdAt: z.number(),
});
export type PromptShortcut = z.infer<typeof PromptShortcutSchema>;

export const PromptShortcutsFileSchema = z.object({
	items: z.record(z.string(), PromptShortcutSchema),
});
export type PromptShortcutsFile = z.infer<typeof PromptShortcutsFileSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** User-supplied fields only; id/createdAt are minted in the IPC handler. */
export const CreatePromptShortcutInputSchema = z.object({
	title: z.string().min(1),
	prompt: z.string().min(1),
	mode: SessionModeSchema,
});
export type CreatePromptShortcutInput = z.infer<
	typeof CreatePromptShortcutInputSchema
>;

/** Full replacement of the user-editable fields of an existing shortcut. */
export const UpdatePromptShortcutInputSchema =
	CreatePromptShortcutInputSchema.extend({
		id: z.string(),
	});
export type UpdatePromptShortcutInput = z.infer<
	typeof UpdatePromptShortcutInputSchema
>;
