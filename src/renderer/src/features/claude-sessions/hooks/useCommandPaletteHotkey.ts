import { useEffect } from "react";
import { useCommandPaletteStore } from "../stores/useCommandPaletteStore";

/**
 * Global Cmd+K — opens the same Skills/Shortcuts picker as the ⚡ buttons,
 * choosing "new session" vs "insert" based on where focus already is.
 * Mounted once, in `MainApp`, next to `useSidequestHotkey` /
 * `useComposerFocusHotkey`.
 *
 *   - Focus inside a session composer (identified by the
 *     `data-composer-session-id` attribute `ImagePasteTextarea` stamps on
 *     its `<textarea>`) → open in "insert" mode for that session, same as
 *     clicking that composer's own ⚡ button.
 *   - Focus nowhere in particular (or on some non-editable element, e.g. a
 *     sidebar row) → open in "new session" mode, same as clicking the
 *     sidebar's ⚡ button.
 *   - Focus inside some OTHER editable field (a rename box, a shortcut
 *     create/edit form, the sidequest composer, a search box…) → no-op.
 *     There's no safe default there — yanking focus out of an unrelated
 *     field to open a picker for a DIFFERENT target would be surprising,
 *     and there's nothing for "insert" to target since it isn't a session
 *     composer. Left as a gap deliberately rather than guessed at.
 *
 * Registered in the capture phase, same as the other global hotkeys.
 * Cmd+K isn't bound anywhere else in this app (no menu accelerator, no
 * other hotkey) — see `src/main/index.ts` — so no `before-input-event`
 * carve-out is needed the way Cmd+R required one.
 */
export function useCommandPaletteHotkey(): void {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "k") return;

			const el = document.activeElement as HTMLElement | null;
			const composerEl = el?.closest<HTMLElement>(
				"[data-composer-session-id]",
			);
			const isEditable =
				!!el
				&& (el.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

			// Focus is in some other editable field, not the session composer —
			// leave the key untouched.
			if (!composerEl && isEditable) return;

			e.preventDefault();
			e.stopPropagation();

			if (composerEl) {
				const sessionId = composerEl.dataset.composerSessionId!;
				useCommandPaletteStore
					.getState()
					.openPalette({ kind: "insert", sessionId });
			} else {
				useCommandPaletteStore.getState().openPalette({ kind: "new-session" });
			}
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
