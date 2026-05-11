import { z } from "zod";

/**
 * A single freeform note attached to a session. Stored as serialized
 * markdown (produced by tiptap-markdown). Multiple notes per session;
 * each is individually deletable and survives app restarts.
 *
 * Lives in its own JSON file (sibling of claude_sessions.json) so per-
 * keystroke debounced saves don't have to rewrite the full session blob
 * (which can be hundreds of KB of message history + diff).
 */
export const NoteSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	markdown: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Note = z.infer<typeof NoteSchema>;

export const SessionNotesFileSchema = z.object({
	notes: z.record(z.string(), NoteSchema),
});
export type SessionNotesFile = z.infer<typeof SessionNotesFileSchema>;
