import { useEffect } from "react";
import { applySessionMode } from "../lib/composerActions";
import { isDraftId, useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";

/**
 * Cmd+P — toggles the focused composer between Plan and Auto-edit, so the
 * mode can be flipped mid-sentence without leaving the keyboard for the
 * `ModeToggle` in the composer footer. Mounted once, in `MainApp`, next to
 * `useSidequestHotkey` / `useComposerFocusHotkey`.
 *
 * Scoped to the composer textarea, deliberately: unlike the other global
 * hotkeys this one is only live while you're actually typing a prompt. The
 * target session is read off the composer element's own
 * `data-composer-session-id` attribute (stamped by `ImagePasteTextarea`, the
 * same hook `useCommandPaletteHotkey` uses) rather than off the route — so it
 * follows focus, and the "text box only" rule is structural rather than a
 * second check bolted on. Focus anywhere else — sidebar, a rename box, a
 * modal — and the key falls through untouched.
 *
 * `SessionMode` is a two-value enum (`plan` | `acceptEdits`), so this is a
 * true toggle rather than a cycle through modes.
 *
 * The sidequest composer is excluded by construction: its textarea carries no
 * `data-composer-session-id`. That's the right outcome anyway — a sidequest's
 * mode goes through `SidequestPanel`'s own `changeMode` and a
 * `sidequest:patch` broadcast, which `applySessionMode` doesn't model.
 *
 * Doesn't respect `ImagePasteTextarea`'s `modeSwitching` / `disabled` state —
 * those are component-local and only ever greyed out that component's own
 * `ModeToggle` mid-request. Same call `applySessionMode` already documents
 * for the Cmd+K path.
 *
 * Registered in the capture phase, same as the other global hotkeys. Cmd+P is
 * bound nowhere else in this app and matches no menu role accelerator — there
 * is no Print item (see `src/main/index.ts`) — so no `before-input-event`
 * carve-out is needed the way Cmd+R required one.
 */
export function usePlanModeHotkey(): void {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "p") return;

			const el = document.activeElement as HTMLElement | null;
			const composerEl = el?.closest<HTMLElement>(
				"[data-composer-session-id]",
			);
			// Not in a session composer — leave the key untouched.
			if (!composerEl) return;

			e.preventDefault();
			e.stopPropagation();

			const sessionId = composerEl.dataset.composerSessionId!;
			const current = isDraftId(sessionId)
				? useDraftSessionsStore.getState().draft?.mode ?? "plan"
				: useSessionsStore.getState().sessions[sessionId]?.mode ?? "plan";

			void applySessionMode(
				sessionId,
				current === "plan" ? "acceptEdits" : "plan",
			);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
