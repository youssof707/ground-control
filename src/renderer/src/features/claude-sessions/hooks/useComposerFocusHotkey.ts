import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { appendQuotedInline, focusComposer } from "../lib/composerActions";

/**
 * Global Cmd+R — focus the main composer. Mounted once, in `MainApp`, next
 * to `useSidequestHotkey`.
 *
 * If text is highlighted anywhere on the page — the transcript, the
 * sidequest panel, notes, wherever — it's appended into the *main*
 * composer's draft, quoted and inline (no newlines). Otherwise this just
 * focuses the composer. Works on draft sessions too, since those render
 * `ImagePasteTextarea` via `DraftSessionChat`.
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
			const selText = sel && !sel.isCollapsed ? sel.toString().trim() : "";
			if (selText) appendQuotedInline(sessionId, selText);
			focusComposer();
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
