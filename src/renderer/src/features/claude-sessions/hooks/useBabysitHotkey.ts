import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useBabysitStore } from "../stores/useBabysitStore";
import { useSessionsStore } from "../stores/useSessionsStore";

/**
 * Global Cmd+Shift+B — opens the Babysitter modal for the active session,
 * without going through its sidebar row's ⋯ menu. Mounted once, in `MainApp`,
 * alongside the other global hotkeys.
 *
 * Modelled on `useModelPickerHotkey`: the route's session id is held in a ref
 * so the listener can stay mounted for the app's lifetime instead of being
 * re-added on every navigation, and the hook only flips the shared
 * `useBabysitStore` open flag — the modal itself renders inside
 * `SessionsList`, which is always mounted in the sidebar.
 *
 * No-ops whenever there's no session to babysit: the index route, and also a
 * draft session (`/sessions/draft-…`), which has no SDK loop and therefore no
 * prompts to answer. Both are covered by the `useSessionsStore` lookup —
 * drafts live in `useDraftSessionsStore` and never appear there.
 *
 * Registered in the capture phase like the rest. Cmd+Shift+B isn't bound
 * anywhere else (no menu accelerator, no other hotkey), so it needs no
 * `before-input-event` carve-out in main the way Cmd+R did.
 */
export function useBabysitHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "b") return;

			const sessionId = activeSessionIdRef.current;
			// Nothing open, or the id is a draft / already-deleted row — let
			// the key fall through untouched.
			if (!sessionId) return;
			if (!useSessionsStore.getState().sessions[sessionId]) return;

			e.preventDefault();
			e.stopPropagation();

			useBabysitStore.getState().openModal(sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
