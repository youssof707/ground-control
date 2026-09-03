import { create } from "zustand";
import type { DeletedSessionSnapshot } from "@shared/claude-sessions/undo";

/**
 * The in-memory buffer behind "undo a deleted session".
 *
 * Deleting a session is otherwise irreversible — `session:delete` erases the
 * record from `claude_sessions.json` and there is no on-disk trace afterwards.
 * So the delete handler hands back a `DeletedSessionSnapshot` of everything it
 * destroyed, and it lands here until the app quits.
 *
 * Deliberately NOT persisted. "In memory for the run" is the whole contract:
 * a buffer that looked durable but silently emptied on relaunch would be a
 * worse promise than no buffer at all. The "Recently deleted" list says so in
 * as many words.
 *
 * Three surfaces read this store:
 *   1. `UndoToast`          — the ~8s prompt after each delete
 *   2. `useUndoHotkey`      — Shift+Cmd+Z, for as long as an entry survives
 *   3. `RecentlyDeletedModal` — the "I noticed twenty minutes later" list
 *
 * All three call the same `restoreEntry` in `lib/undoActions.ts`, so there is
 * exactly one restore path and no chance of the button and the key drifting.
 */

/**
 * Which reversible action produced this entry. Drives the toast's wording
 * only — every kind restores through the same code path.
 *
 *   delete  — the session was deleted from the sidebar's ⋯ menu
 *   handoff — "Handoff & delete" destroyed the source after the successor's
 *             first turn landed. Worth its own wording: by then the user is
 *             looking at a brand-new session, and an unexplained "Deleted …"
 *             appearing there reads as an error report.
 *   archive — reversible already; see the `snapshot: null` note below
 */
export type UndoKind = "delete" | "handoff" | "archive";

export interface UndoEntry {
	/** Buffer-entry id. Distinct from `sessionId` — the same session could in
	 *  principle be restored and deleted again within one run. */
	id: string;
	kind: UndoKind;
	sessionId: string;
	/** Captured at push time: the session row is gone from the store by the
	 *  time anything renders this, so the title can't be dereferenced later. */
	title: string;
	/**
	 * The payload `session:restore` needs. Null for `archive`, which needs no
	 * snapshot at all — archiving only sets `archivedAt`, so undoing it is a
	 * plain `unarchiveSession` call and the record never left disk.
	 */
	snapshot: DeletedSessionSnapshot | null;
	/** True when the user also ticked "Also delete worktree". Surfaced in the
	 *  toast, because that half genuinely cannot be undone. */
	worktreeDeleted: boolean;
}

/**
 * Cap on retained deletions. Each snapshot carries the session's entire
 * message array (sessions in this app routinely reach hundreds of KB), so the
 * buffer is not free. Twenty is far past any realistic oops-window while
 * keeping worst-case retention bounded.
 */
const MAX_ENTRIES = 20;

/** Undo entries live and die with the process, so a counter is enough — no
 *  need to reach for `ulid`. Same reasoning as useBackgroundTasksStore. */
let seq = 0;

interface State {
	/** Newest first. `entries[0]` is what Shift+Cmd+Z and the toast act on. */
	entries: UndoEntry[];
	/**
	 * The entry the toast is currently showing, or null for "no toast".
	 *
	 * Held separately from `entries` because dismissing the toast (×) must NOT
	 * drop the undo — the key and the Recently-deleted list keep working. The
	 * toast is a notification, not the mechanism.
	 */
	toastEntryId: string | null;
	/**
	 * Session id to flash in the sidebar, set for ~1.2s right after a restore.
	 * Lives here rather than in its own store because it has exactly one
	 * producer (restore) and one consumer (`SessionRowSidebar`).
	 */
	flashSessionId: string | null;

	push: (entry: Omit<UndoEntry, "id">) => void;
	/** Drop an entry outright — it's been restored, or aged out of the cap. */
	remove: (id: string) => void;
	/** Hide the toast without touching the buffer. */
	dismissToast: () => void;
	setFlash: (sessionId: string | null) => void;
}

export const useUndoStore = create<State>((set) => ({
	entries: [],
	toastEntryId: null,
	flashSessionId: null,

	push: (entry) =>
		set((st) => {
			const full: UndoEntry = { ...entry, id: `undo-${++seq}` };
			return {
				entries: [full, ...st.entries].slice(0, MAX_ENTRIES),
				// A new deletion always re-raises the toast, even if the user
				// dismissed the previous one — this is a fresh event, not the
				// one they waved away.
				toastEntryId: full.id,
			};
		}),

	remove: (id) =>
		set((st) => {
			const entries = st.entries.filter((e) => e.id !== id);
			// If the toast was showing the entry we just consumed, advance it
			// to the next pending one so a run of deletes can be unwound
			// without the toast blinking out mid-sequence.
			//
			// But only if the toast was actually up: if the user had dismissed
			// it, restoring via the hotkey must not resurrect a toast they
			// explicitly waved away.
			const toastEntryId =
				st.toastEntryId === id
					? (entries[0]?.id ?? null)
					: st.toastEntryId;
			return { entries, toastEntryId };
		}),

	dismissToast: () => set({ toastEntryId: null }),

	setFlash: (sessionId) => set({ flashSessionId: sessionId }),
}));

/**
 * Imperative push, so plain click handlers and fire-and-forget background
 * callbacks can record an undo without being inside a component. Mirrors
 * `runBackgroundTask`'s module-level entry point.
 */
export function pushUndo(entry: Omit<UndoEntry, "id">): void {
	useUndoStore.getState().push(entry);
}
