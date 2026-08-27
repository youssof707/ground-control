import { useDraftStore } from "../stores/useDraftStore";

/**
 * Imperative main-composer operations, shared by the global Cmd+R handler.
 * Deliberately store-only (no hooks) so they can run from a window keydown
 * listener outside React's render cycle. Mirrors lib/sidequestActions.ts,
 * but appends inline (no trailing newline) since this quotes into a single
 * ongoing message rather than a fresh sidequest turn.
 */

/** Wrap a selection for pasting into the composer: quoted, inline. */
export function quoteInline(text: string): string {
	return `"${text.trim()}"`;
}

/**
 * Append a quoted selection to a session's composer draft, inline.
 *
 * Appends rather than replaces: the user may already have typed a question
 * before selecting more evidence, and clobbering that would be hostile.
 * Existing trailing whitespace is trimmed and the quote is joined with a
 * single space — no newlines are introduced either side.
 */
export function appendQuotedInline(sessionId: string, text: string): void {
	const { draftsBySession, setDraftText } = useDraftStore.getState();
	const existing = draftsBySession[sessionId]?.text ?? "";
	const trimmed = existing.replace(/\s+$/, "");
	const next = trimmed
		? `${trimmed} ${quoteInline(text)}`
		: quoteInline(text);
	setDraftText(sessionId, next);
}

/** Ask the main composer to focus (caret at end). */
export function focusComposer(): void {
	useDraftStore.getState().bumpComposerFocus();
}
