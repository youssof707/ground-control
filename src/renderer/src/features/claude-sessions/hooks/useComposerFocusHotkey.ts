import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { appendQuotedInline, focusComposer } from "../lib/composerActions";
import { openSidequestPanelAndFocus } from "../lib/sidequestActions";
import { selectionStartElement, selectionText } from "../lib/selection";
import { useSidequestsStore } from "../stores/useSidequestsStore";

/**
 * Global Cmd+R — quote the current selection into a composer and focus it.
 * Mounted once, in `MainApp`, next to `useSidequestHotkey`.
 *
 * The quote lands in whichever conversation you highlighted *from*:
 *
 *   - Selection started inside the sidequest panel (and a sidequest exists)
 *     → the sidequest's composer. The main composer is left alone and never
 *     takes focus.
 *   - Anything else — main transcript, notes, or no selection at all → the
 *     main composer, even while the sidequest panel is open.
 *
 * That's the same `[data-sidequest-panel]` attribution rule `useSidequestHotkey`
 * uses for its CASE 2, so the two hotkeys agree on what "inside the sidequest"
 * means. Cmd+R never forks or opens a sidequest, though — that's Cmd+S's job.
 * Works on draft sessions too, since those render `ImagePasteTextarea` via
 * `DraftSessionChat`.
 *
 * Registered in the capture phase, same as `useSidequestHotkey`. Cmd+R is
 * freed up for this in the main process (custom View menu without the
 * `reload` role, and a `before-input-event` handler that never touches
 * KeyR) — see `src/main/index.ts`. Shift+Cmd+R (Force Reload) is left
 * alone by bailing whenever any modifier besides Cmd is held.
 *
 * Note: a selection inside a `<textarea>` is control-internal, so
 * `window.getSelection().toString()` returns "" in Chromium. Highlighting
 * text in the composer itself and hitting Cmd+R therefore just focuses it —
 * the sane outcome.
 */
export function useComposerFocusHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "r") return;

			const sessionId = activeSessionIdRef.current;
			// Not on a session route — no composer to focus. Let the key fall
			// through untouched.
			if (!sessionId) return;

			e.preventDefault();
			e.stopPropagation();

			const sel = window.getSelection();
			const selText = selectionText(sel);
			const inPanel = selText
				? (selectionStartElement(sel)?.closest(
					"[data-sidequest-panel]",
				) ?? null)
				: null;
			const sq = useSidequestsStore.getState().byParent[sessionId];

			// Highlighted inside the sidequest → quote back into that same
			// conversation and focus its composer. Returning here is the point:
			// bumping the main composer's focus nonce too would yank focus out
			// of the panel. Falls through to the main composer when no sidequest
			// is registered (e.g. a selection in the panel header pre-fork).
			if (inPanel && sq) {
				// Deliberately `appendQuotedInline`, not sidequestActions'
				// `appendQuotedToDraft`: Cmd+R quotes into the sentence you're
				// already writing, so it stays inline. Cmd+S appends a trailing
				// newline because it opens a fresh turn. Same store either way —
				// drafts are keyed by sidequest id here, session id below.
				appendQuotedInline(sq.sidequestId, selText);
				openSidequestPanelAndFocus();
				return;
			}

			if (selText) appendQuotedInline(sessionId, selText);
			focusComposer();
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
