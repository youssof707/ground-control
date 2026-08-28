/**
 * DOM-selection helpers shared by the global hotkeys that quote highlighted
 * text into a composer — `useSidequestHotkey` (Cmd+S) and
 * `useComposerFocusHotkey` (Cmd+R).
 *
 * Both need the same two facts about the current selection: what it says, and
 * where it started. Kept store-free and hook-free so they can run from a window
 * keydown listener outside React's render cycle.
 *
 * Note: a selection inside a `<textarea>` or `<input>` is control-internal, so
 * `window.getSelection().toString()` returns "" in Chromium. Highlighting text
 * in a composer therefore reads as "no selection" to both callers, which is the
 * sane outcome — they fall through to focus-only behaviour.
 */

/** Trimmed text of the current selection, or "" if collapsed/absent/blank. */
export function selectionText(sel: Selection | null): string {
	return sel && !sel.isCollapsed ? sel.toString().trim() : "";
}

/**
 * The Element the selection *started* in — text nodes resolve to their
 * `parentElement`. Returns null when there's no live range.
 *
 * "Started" matters: a selection dragged across several messages resolves to
 * the first one, which is where the user began dragging. Callers use this with
 * `closest()` to attribute the selection to a container — `[data-message-id]`
 * or `[data-sidequest-panel]`.
 */
export function selectionStartElement(sel: Selection | null): Element | null {
	if (!sel || sel.rangeCount === 0) return null;
	const node = sel.getRangeAt(0).startContainer;
	return node.nodeType === Node.ELEMENT_NODE
		? (node as Element)
		: node.parentElement;
}
