import { z } from "zod";
import { SessionModeSchema } from "./claude_session";

/**
 * Saved session shortcut — a one-click recipe for starting a session:
 * pick it from the sidebar Shortcuts dropdown and a draft session is
 * created with the shortcut's folder, prompt text, and mode pre-filled,
 * ready to send.
 *
 * `title` is optional display/session naming ("" = untitled): the
 * dropdown falls back to the cwd's folder name, and an untitled
 * shortcut leaves the draft's auto "Session N" placeholder in place.
 */
export const ShortcutSchema = z.object({
	id: z.string(),
	title: z.string(),
	cwd: z.string(),
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
	title: z.string(),
	cwd: z.string(),
	prompt: z.string(),
	mode: SessionModeSchema,
});
export type CreateShortcutInput = z.infer<typeof CreateShortcutInputSchema>;
