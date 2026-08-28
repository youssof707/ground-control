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
 * Append a quoted selection to a composer draft, inline.
 *
 * `draftId` is whatever `useDraftStore` is keyed by for that composer: a
 * session id for the main composer, a sidequest id for the sidequest panel's.
 * Cmd+R passes either, depending on where the selection was highlighted.
 *
 * Appends rather than replaces: the user may already have typed a question
 * before selecting more evidence, and clobbering that would be hostile.
 * Existing trailing whitespace is trimmed and the quote is joined with a
 * single space — no newlines are introduced either side.
 */
export function appendQuotedInline(draftId: string, text: string): void {
	const { draftsBySession, setDraftText } = useDraftStore.getState();
	const existing = draftsBySession[draftId]?.text ?? "";
	const trimmed = existing.replace(/\s+$/, "");
	const next = trimmed
		? `${trimmed} ${quoteInline(text)}`
		: quoteInline(text);
	setDraftText(draftId, next);
}

/** Ask the main composer to focus (caret at end). */
export function focusComposer(): void {
	useDraftStore.getState().bumpComposerFocus();
}

/**
 * Append a saved shortcut's prompt to a session's composer draft, as its
 * own block.
 *
 * Appends rather than replaces, same rationale as `appendQuotedInline`.
 * Joined with a newline (not a space) since a shortcut's prompt is its own
 * paragraph, not an inline quotation.
 */
export function appendPromptBlock(sessionId: string, prompt: string): void {
	const { draftsBySession, setDraftText } = useDraftStore.getState();
	const trimmed = (draftsBySession[sessionId]?.text ?? "").replace(
		/\s+$/,
		"",
	);
	setDraftText(sessionId, trimmed ? `${trimmed}\n${prompt}` : prompt);
}
