import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useUndoStore } from "../stores/useUndoStore";
import { undoMostRecent } from "../lib/undoActions";

/**
 * Global Shift+Cmd+Z — restores the most recently destroyed session from
 * anywhere. Mounted once, in `MainApp`, next to the other global hotkeys.
 *
 * ## Why Shift+Cmd+Z and not Cmd+Z
 *
 * Cmd+Z is the single most-used text shortcut in this app (the composer, the
 * notes editor, every shortcut form). Claiming it globally would mean
 * hand-rebuilding the native Edit menu, which currently ships as
 * `{ role: "editMenu" }` in `src/main/index.ts` — the same class of collision
 * Cmd+R had, and it was solved there by replacing the whole menu template.
 * Shift+Cmd+Z sidesteps the expensive half of that problem.
 *
 * It is still the native **Redo** accelerator, but the stakes are far lower:
 * guard 1 below preserves redo inside text fields completely, and outside a
 * text field redo is a no-op — so nothing the user can currently do is lost.
 * If the menu accelerator ever wins over this listener in practice, the fix is
 * the same hand-built-menu carve-out used for Cmd+R, scoped to the redo item.
 *
 * ## The two guards
 *
 *  1. **Never when an editable element has focus.** Native text redo wins,
 *     untouched. Same carve-out `useCommandPaletteHotkey` and
 *     `useModelPickerHotkey` already make.
 *
 *     NOTE this is the deliberate OPPOSITE of `useSidequestHotkey`, which does
 *     not skip editables because a transcript selection coexists with focus in
 *     the composer. Do not "fix" the inconsistency — the two hotkeys want
 *     genuinely different things.
 *
 *  2. **Never when the buffer is empty.** We return without calling
 *     `preventDefault`, so with nothing to undo the key falls through
 *     completely and can't shadow anything.
 */
export function useUndoHotkey(): void {
	const navigate = useNavigate();
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation — same
	// pattern as the activeSessionId refs in the sibling hotkey hooks.
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "z") return;

			// Guard 1 — text fields keep their native redo.
			const el = document.activeElement as HTMLElement | null;
			const isEditable =
				!!el &&
				(el.isContentEditable ||
					["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
			if (isEditable) return;

			// Guard 2 — nothing buffered, so this key isn't ours. Checked
			// BEFORE preventDefault so the fall-through is genuine.
			if (useUndoStore.getState().entries.length === 0) return;

			e.preventDefault();
			e.stopPropagation();

			undoMostRecent((to) => navigateRef.current(to));
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
