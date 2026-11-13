import { create } from "zustand";
import type { DeletedSessionSnapshot } from "@shared/claude-sessions/undo";

export interface UndoEntry {
	id: string;
	sessionId: string;
	title: string;
	snapshot: DeletedSessionSnapshot;
	worktreeDeleted: boolean;
}

const MAX_ENTRIES = 20;

let seq = 0;

interface State {
	entries: UndoEntry[];
	flashSessionId: string | null;

	push: (entry: Omit<UndoEntry, "id">) => void;
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

export function pushUndo(entry: Omit<UndoEntry, "id">): void {
	useUndoStore.getState().push(entry);
}
