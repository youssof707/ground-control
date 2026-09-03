import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { startNewSessionDraft } from "../lib/sessionStartActions";
import { useSettingsStore } from "../stores/useSettingsStore";

/**
 * Global Cmd+N — opens a new session draft, the macOS "new document" idiom.
 * Mounted once, in `MainApp`, next to `useSidequestHotkey` /
 * `useComposerFocusHotkey`.
 *
 * The draft is seeded with the worktree last used in the target workspace
 * (see `resolveSeedWorktreeId`), so returning to a repo resumes on the branch
 * checkout you were working in rather than the bare base dir. Shares
 * `startNewSessionDraft` with the sidebar's own New Session button so the two
 * can't drift.
 *
 * Works from anywhere, session route or not — "new session" is not scoped to
 * an existing one. It does not require focus to be outside an editable field
 * either: Cmd+N means nothing to a textarea, and the sidebar button is
 * frequently clicked while a composer holds focus.
 *
 * `targetCwd` is read straight from `lastUsedWorkspace` rather than from
 * `SessionsList`'s `workspaceFilter`, which is local component state this
 * hook has no access to. Same accepted gap `startSessionFromShortcut`
 * documents for the global Cmd+K palette: with the filter narrowed to a
 * single workspace, the button would target that one and the hotkey targets
 * the last-used one instead. Falls back to the native folder picker when no
 * workspace has ever been used, so Cmd+N still works on a fresh install.
 *
 * Registered in the capture phase, same as the other global hotkeys. Cmd+N is
 * bound nowhere else in this app and matches no menu role accelerator — the
 * File menu carries only Close and Quit (see `src/main/index.ts`) — so no
 * `before-input-event` carve-out is needed the way Cmd+R required one.
 */
export function useNewSessionHotkey(): void {
	const navigate = useNavigate();
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "n") return;

			e.preventDefault();
			e.stopPropagation();

			const targetCwd =
				useSettingsStore.getState().lastUsedWorkspace ?? null;
			void startNewSessionDraft(navigateRef.current, { targetCwd });
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
