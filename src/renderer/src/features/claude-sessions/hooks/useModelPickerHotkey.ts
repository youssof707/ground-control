import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useModelPickerStore } from "../stores/useModelPickerStore";

/**
 * Global Cmd+Shift+M — opens the model picker for the active session from
 * anywhere, no mouse travel to the footer model button required. Mounted
 * once, in `MainApp`, next to `useSidequestHotkey` / `useComposerFocusHotkey`.
 *
 * The picker itself still renders inside `SessionTokenBar` — this hook only
 * flips the shared `useModelPickerStore` open flag that component reads,
 * same pattern as `useCommandPaletteHotkey` driving `useCommandPaletteStore`
 * from outside the composer. Draft sessions (`DraftSessionChat`) own their
 * picker's open state locally rather than through this store, so the hotkey
 * is a no-op there for now — v1 targets the "switch model mid-run" routine
 * this feature is about, which only applies to real, already-running
 * sessions.
 *
 * Picking a model while the session is running/awaiting-permission routes
 * through `switchModelAndResume` (see ModelPickerModal's `onSwitchAndResume`
 * wiring in SessionTokenBar) — interrupt, switch, resume, in one shot.
 *
 * Registered in the capture phase, same as the other global hotkeys.
 * Cmd+Shift+M isn't bound anywhere else in this app (no menu accelerator, no
 * other hotkey — see `src/main/index.ts`), so no `before-input-event`
 * carve-out is needed the way Cmd+R required one.
 */
export function useModelPickerHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "m") return;

			const sessionId = activeSessionIdRef.current;
			// Not on a session route — no picker to open. Let the key fall
			// through untouched.
			if (!sessionId) return;

			e.preventDefault();
			e.stopPropagation();

			useModelPickerStore.getState().open(sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
