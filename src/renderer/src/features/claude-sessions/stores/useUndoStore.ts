import { create } from "zustand";
import type { DeletedSessionSnapshot } from "@shared/claude-sessions/undo";

export interface UndoEntry {
	/** Buffer-entry id. Distinct from `sessionId` — the same session could in
	 *  principle be restored and deleted again within one run. */
	id: string;
	sessionId: string;
	/** Captured at push time: the session row is gone from the store by the
	 *  time anything renders this, so the title can't be dereferenced later. */
	title: string;
	/** The payload `session:restore` needs. */
	snapshot: DeletedSessionSnapshot;
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
	entries: UndoEntry[];
	/**
	 * Session id to flash in the sidebar, set for ~1.2s right after a restore.
	 * Lives here rather than in its own store because it has exactly one
	 * producer (restore) and one consumer (`SessionRowSidebar`).
	 */
	flashSessionId: string | null;

	push: (entry: Omit<UndoEntry, "id">) => void;
	/** Drop an entry outright — it's been restored, or aged out of the cap. */
	remove: (id: string) => void;
	setFlash: (sessionId: string | null) => void;
}

export const useUndoStore = create<State>((set) => ({
	entries: [],
	flashSessionId: null,

	push: (entry) =>
		set((st) => ({
			entries: [{ ...entry, id: `undo-${++seq}` }, ...st.entries].slice(
				0,
				MAX_ENTRIES,
			),
		})),

	remove: (id) =>
		set((st) => ({ entries: st.entries.filter((e) => e.id !== id) })),

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
