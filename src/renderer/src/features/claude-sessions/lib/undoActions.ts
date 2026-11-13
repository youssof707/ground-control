import { useSessionsStore } from "../stores/useSessionsStore";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";
import { useUndoStore, type UndoEntry } from "../stores/useUndoStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";

/** How long the restored sidebar row stays washed in accent. */
const FLASH_MS = 1200;

/** Minimal shape of react-router's `navigate`, so this file stays hook-free. */
type NavigateFn = (to: string) => void;

/**
 * Draw the eye to the row that just came back.
 *
 * Navigation already proves the restore worked; this answers the other
 * question — *where did it land?* The sidebar sorts by recency, so a restored
 * session reappears in its original slot, which can be well off-screen in a
 * long list.
 */
function flashRow(sessionId: string): void {
	const undo = useUndoStore.getState();
	undo.setFlash(sessionId);
	setTimeout(() => {
		// Guard against a second restore having claimed the flash in the
		// meantime — clearing unconditionally would cut the newer one short.
		if (useUndoStore.getState().flashSessionId === sessionId) {
			useUndoStore.getState().setFlash(null);
		}
	}, FLASH_MS);
}

export function restoreEntry(entry: UndoEntry, navigate: NavigateFn): void {
	const snapshot = entry.snapshot;

	// Captured out of `run` because runBackgroundTask's onSuccess receives no
	// value — and we need main's canonical restored record, not our snapshot
	// copy: main normalizes `status` (a session deleted mid-turn comes back
	// cancelled, not running) and drops a dangling group/worktree binding.
	let restored: Awaited<
		ReturnType<typeof window.claude.restoreSession>
	> | null = null;

	runBackgroundTask({
		label: `Restoring ${entry.title}`,
		run: async () => {
			restored = await window.claude.restoreSession({
				...snapshot,
				worktreeDeleted: entry.worktreeDeleted,
			});
		},
		onSuccess: () => {
			if (!restored) return;
			const session = restored;

			// Re-create the group in the local cache first, so the sidebar
			// never renders a member row whose group header doesn't exist yet.
			// `session:restore` broadcasts skip-self, so this window would
			// otherwise not learn about the re-created group at all.
			if (snapshot.prunedGroup) {
				useSessionGroupsStore.getState().upsert(snapshot.prunedGroup);
			}

			// Lifts the renderer tombstone AND re-inserts the row, atomically.
			// Without the untombstone the row would go straight back to inert.
			useSessionsStore.getState().restoreSession(session);

			// Deliberately NOT touching useWorktreesStore's `sessionIds`
			// reverse index: this window's copy is already known-stale (main
			// broadcasts worktree mutations skip-self), which is why the
			// sidebar counts worktree occupancy from the sessions store
			// instead. See `isLastOnWorktree` in SessionsList.

			useUndoStore.getState().remove(entry.id);
			navigate(`/sessions/${session.id}`);
			flashRow(session.id);
		},
	});
}

/**
 * Restore the most recent entry. One undo step = one destroyed session, so
 * pressing repeatedly walks back through the buffer newest-first — the
 * behaviour every text editor has trained people to expect.
 *
 * No-op on an empty buffer, which is what lets the hotkey fall through
 * untouched when there's nothing to undo.
 */
export function undoMostRecent(navigate: NavigateFn): void {
	const entry = useUndoStore.getState().entries[0];
	if (!entry) return;
	restoreEntry(entry, navigate);
}
