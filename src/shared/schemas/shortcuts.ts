import { z } from "zod";
import { SessionModeSchema } from "./claude_session";

/**
 * Saved shortcut — a reusable prompt + mode. Pick one from the ⚡ menu:
 * from the sidebar it starts a new session (using the same folder-resolution
 * as "New Session") with the prompt pre-filled in the composer; from inside
 * a session it appends the prompt to whatever you're already writing. Same
 * model, same menu, same modals in both places.
 *
 * `title` is required (unlike a session shortcut, there is no cwd to fall
 * back on for a menu label) — but only on the *input* schemas. This schema
 * is what `ShortcutsFileSchema.parse` runs against at boot, and a parse
 * failure there hits the `app.exit(1)` branch in main/index.ts. A
 * hand-edited or legacy blank title must not brick startup, so reads stay
 * permissive and the renderer falls back to a prompt preview.
 */
export const ShortcutSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	mode: SessionModeSchema,
	createdAt: z.number(),
});
export type Shortcut = z.infer<typeof ShortcutSchema>;

export const ShortcutsFileSchema = z.object({
	items: z.record(z.string(), ShortcutSchema),
});
export type ShortcutsFile = z.infer<typeof ShortcutsFileSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** User-supplied fields only; id/createdAt are minted in the IPC handler. */
export const CreateShortcutInputSchema = z.object({
	title: z.string().min(1),
	prompt: z.string().min(1),
	mode: SessionModeSchema,
});
export type CreateShortcutInput = z.infer<typeof CreateShortcutInputSchema>;

/** Full replacement of the user-editable fields of an existing shortcut. */
export const UpdateShortcutInputSchema = CreateShortcutInputSchema.extend({
	id: z.string(),
});
export type UpdateShortcutInput = z.infer<typeof UpdateShortcutInputSchema>;
