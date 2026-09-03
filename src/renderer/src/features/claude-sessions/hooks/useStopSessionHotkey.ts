import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { stopSession } from "../lib/sessionControlActions";
import { isDraftId } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";

/**
 * Global Cmd+. — interrupts the active session's running turn, the macOS
 * "cancel the current operation" idiom, without mouse travel to the Stop pill
 * in the composer. Mounted once, in `MainApp`, next to `useSidequestHotkey` /
 * `useComposerFocusHotkey`.
 *
 * Routes through `stopSession` rather than `window.claude.interruptSession`
 * so the queued-message latch fires — see that function's doc for why a bare
 * interrupt would immediately start another turn.
 *
 * Deliberately ignores focus, same as `useSidequestHotkey`: the common case
 * is focus sitting in the composer while the turn you want to stop runs above
 * it, and Cmd+. means nothing to a textarea.
 *
 * Sidequests are out of scope. They're separate sessions that live in
 * `useSidequestsStore` (patched via `sidequest:patch`, never in
 * `useSessionsStore`), so the running-check below can't see them, and their
 * panel owns its own Stop button and `interrupting` state. Targeting only the
 * route session keeps "what does Cmd+. stop?" unambiguous rather than making
 * it depend on where focus happens to be — left as a deliberate gap, the way
 * `useCommandPaletteHotkey` documents its own.
 *
 * Registered in the capture phase, same as the other global hotkeys. Cmd+. is
 * bound nowhere else in this app and matches no menu role accelerator (see
 * `src/main/index.ts`), so no `before-input-event` carve-out is needed the way
 * Cmd+R required one.
 */
export function useStopSessionHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key !== ".") return;

			const sessionId = activeSessionIdRef.current;
			// Every bail happens BEFORE preventDefault so Cmd+. stays inert
			// rather than swallowed when there's no turn to interrupt.
			if (!sessionId) return;
			// A draft has no session on the main side yet — nothing to stop.
			if (isDraftId(sessionId)) return;
			const status = useSessionsStore.getState().sessions[sessionId]?.status;
			// Only a live turn is interruptible. `awaiting_permission` is
			// excluded on purpose: the turn is parked on a permission card, and
			// the answer there is to deny it, not to tear the query down.
			if (status !== "running") return;

			e.preventDefault();
			e.stopPropagation();

			void stopSession(sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
