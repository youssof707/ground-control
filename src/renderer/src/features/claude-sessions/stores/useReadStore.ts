import { create } from "zustand";

/**
 * Per-session "last read at" timestamps. Source of truth lives in the main
 * process (`read_state.json`); this store is a thin in-memory cache that:
 *   - hydrates on app boot (via `useSessionsBootstrap`),
 *   - re-hydrates on every `state:changed` ping from main,
 *   - applies optimistic local updates in `markRead` so the originating
 *     window's UI doesn't wait for a round-trip.
 *
 * No localStorage — every window reads from the same JSON file via IPC, so
 * there's no risk of windows drifting out of sync.
 */
interface State {
	lastReadAt: Record<string, number>;
	hydrate: (map: Record<string, number>) => void;
	markRead: (sessionId: string, ts?: number) => void;
}

export const useReadStore = create<State>((set) => ({
	lastReadAt: {},
	hydrate: (map) => set({ lastReadAt: { ...map } }),
	markRead: (sessionId, ts) =>
		set((s) => {
			const next = ts ?? Date.now();
			// Monotonic guard — never roll back. Mirrors the same check in
			// `src/main/core/store/read_state.ts` so an out-of-order refetch
			// can't undo a more recent local mark either.
			if ((s.lastReadAt[sessionId] ?? 0) >= next) return s;
			// Fire-and-forget IPC. Main persists, then broadcasts
			// `state:changed` to every other window (skip-self) which triggers
			// their refetch.
			void window.claude?.markRead(sessionId, next);
			return { lastReadAt: { ...s.lastReadAt, [sessionId]: next } };
		}),
}));
