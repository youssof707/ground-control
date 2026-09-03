import { useSessionsStore } from "../stores/useSessionsStore";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";
import { useSessionNotesStore } from "../stores/useSessionNotesStore";
import { useUndoStore, type UndoEntry } from "../stores/useUndoStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";

/**
 * Imperative "undo a destroyed session" operations, store-only (no hooks) so
 * they can run from a plain click handler, a global keydown listener, or a
 * modal row — exactly like lib/handoffActions.ts.
 *
 * There is deliberately ONE restore path. The toast button, Shift+Cmd+Z, and
 * the "Recently deleted" list all funnel through `restoreEntry`, so the button
 * and the key can never drift into meaning different things — which is the
 * whole reason this reads as an undo stack rather than a dialog.
 */

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

/**
 * Put back one buffered entry.
 *
 * Runs through `runBackgroundTask` rather than being awaited, for the same
 * reason `runHandoffDelete` does: the caller may be a toast that is about to
 * unmount, or a keydown handler with nowhere to show an error. A failure must
 * not disappear — it surfaces in the background-task indicator, and crucially
 * the entry STAYS in the buffer so the user can simply press undo again.
 *
 * Every local store write lives in `onSuccess`, so a failed restore leaves the
 * renderer exactly as it was rather than showing a row that main doesn't have.
 */
export function restoreEntry(entry: UndoEntry, navigate: NavigateFn): void {
	// Archive never left disk — undoing it is just clearing `archivedAt`, and
	// there's no snapshot to replay. Split early so the delete path below
	// doesn't have to keep testing for it.
	if (entry.kind === "archive") {
		runBackgroundTask({
			label: `Restoring ${entry.title}`,
			run: () => window.claude.unarchiveSession(entry.sessionId),
			onSuccess: () => {
				// Main broadcasts `session:patch` with `archivedAt: undefined`
				// to every window including this one, which already clears the
				// field — but do it locally too so the row un-dims on the same
				// tick as the click rather than one IPC round-trip later.
				useSessionsStore
					.getState()
					.upsertSession({ id: entry.sessionId, archivedAt: undefined });
				useUndoStore.getState().remove(entry.id);
				navigate(`/sessions/${entry.sessionId}`);
				flashRow(entry.sessionId);
			},
		});
		return;
	}

	const snapshot = entry.snapshot;
	if (!snapshot) return;

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

			// Seed the notes cache from the snapshot rather than waiting for
			// the panel's lazy fetch, so opening Notes right after an undo
			// shows the restored notes immediately.
			if (snapshot.notes.length > 0) {
				useSessionNotesStore
					.getState()
					.hydrateForSession(session.id, snapshot.notes);
			}

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
