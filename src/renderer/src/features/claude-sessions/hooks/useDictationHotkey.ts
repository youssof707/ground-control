import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { getDictationHandle } from "../lib/dictationRegistry";
import { focusComposer } from "../lib/composerActions";
import { openSidequestPanelAndFocus } from "../lib/sidequestActions";
import { useSidequestsStore } from "../stores/useSidequestsStore";

/**
 * Global Cmd+D — starts voice dictation, or stops whichever take is already
 * running. Mounted once, in `MainApp`, next to the other global hotkeys.
 *
 * Scoped to "a session is open", not to composer focus: unlike Cmd+P (which
 * only makes sense mid-sentence in a specific composer), Cmd+D is meant to
 * work from anywhere in the app the moment you'd rather talk than type. Off
 * a session route there's no composer to target, so the key falls through
 * untouched.
 *
 * Two rules, in order:
 *
 *   1. A take already in progress owns the key, wherever focus currently is.
 *      This is what makes Cmd+D a true toggle, and guarantees it can never
 *      open a second microphone — pressing it again always stops the one
 *      take that exists for this session, regardless of where you clicked or
 *      tabbed to in the meantime.
 *   2. Otherwise, start a take in the composer that has focus:
 *      `[data-sidequest-panel]` → the sidequest composer, anything else → the
 *      main composer. Focus attribution, not selection attribution like
 *      Cmd+R — dictation lands at a caret, and a caret only exists where
 *      focus is. Same `[data-sidequest-panel]` boundary Cmd+R/Cmd+S use, so
 *      all three agree on what "inside the sidequest" means.
 *
 * Rule 2 bails out of any OTHER editable element (a rename box, the notes
 * editor, a search field): starting a take there would rip focus out of it
 * seconds later when the transcript lands, with no visible cause in the
 * meantime. Same gap `useCommandPaletteHotkey` documents and leaves
 * deliberately. Focus on a non-editable element (transcript, sidebar, empty
 * space) still starts a take in the main composer — that's the "global" part
 * of the brief.
 *
 * `DictationButton.toggle()` is the source of truth for whether Cmd+D
 * actually did anything — it already knows about `disabled` (a pending
 * permission request, an in-flight send, a starting sidequest) and about the
 * busy states (`starting` / `downloading` / `transcribing`) where the button
 * itself is disabled. This hook only decides WHICH instance to call; every
 * inert case falls out of `toggle()` returning false, and the key is then
 * left unswallowed rather than eaten.
 *
 * Focus is bumped only on the START path (rule 2), never on stop: a stopped
 * take's transcript should land wherever the user actually left the caret,
 * not get dragged to the end the way `focusComposer` positions a fresh one.
 * Rule 1 owns every stop, so that's structural here, not an extra check.
 *
 * Registered in the capture phase, same as the other global hotkeys. Cmd+D
 * isn't bound anywhere else in this app (no menu accelerator, no other
 * hotkey) — see `src/main/index.ts` — so no `before-input-event` carve-out is
 * needed the way Cmd+R required one.
 */
export function useDictationHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "d") return;

			const sessionId = activeSessionIdRef.current;
			// No session open — no composer exists for Cmd+D to target. Let the
			// key fall through untouched.
			if (!sessionId) return;

			// Drafts included on purpose — `DraftSessionChat` renders the same
			// `ImagePasteTextarea`, and dictation already works there today.
			const sqScope =
				useSidequestsStore.getState().byParent[sessionId]?.sidequestId;

			// RULE 1 — an in-flight take owns the key, wherever focus is.
			for (const scope of [sessionId, sqScope]) {
				const handle = scope ? getDictationHandle(scope) : null;
				if (!handle?.isBusy()) continue;
				if (handle.toggle()) {
					e.preventDefault();
					e.stopPropagation();
				}
				return;
			}

			// RULE 2 — nothing in flight: start in whichever composer has focus.
			const el = document.activeElement as HTMLElement | null;
			const inPanel = !!el?.closest("[data-sidequest-panel]");
			const inComposer =
				inPanel || !!el?.closest("[data-composer-session-id]");
			const isEditable =
				!!el
				&& (el.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
			// Focus is in some OTHER text field, not a session composer — leave
			// the key untouched (see the doc comment above).
			if (isEditable && !inComposer) return;

			const scope = inPanel && sqScope ? sqScope : sessionId;
			const handle = getDictationHandle(scope);
			// No composer mounted for this scope (e.g. sidequest panel closed
			// mid-race). Nothing to start.
			if (!handle) return;
			if (!handle.toggle()) return;

			if (scope === sqScope) openSidequestPanelAndFocus();
			else focusComposer();

			e.preventDefault();
			e.stopPropagation();
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
