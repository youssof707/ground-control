import { create } from "zustand";

/**
 * Per-session "minimized" flag for the inline permission cards in the
 * sessions list. Source of truth lives in the main process
 * (`minimized_permissions.json`); this store is a thin in-memory cache that:
 *   - hydrates on app boot (via `useSessionsBootstrap`),
 *   - re-hydrates on every `state:changed` ping from main,
 *   - applies optimistic local updates in `setMinimized` so the originating
 *     window's UI doesn't wait for a round-trip.
 *
 * Mirrors `useReadStore`. No localStorage — every window reads from the same
 * JSON file via IPC, so there's no risk of windows drifting out of sync.
 */
interface State {
	minimized: Record<string, boolean>;
	hydrate: (map: Record<string, boolean>) => void;
	setMinimized: (sessionId: string, value: boolean) => void;
}

export const useMinimizedPermissionsStore = create<State>((set) => ({
	minimized: {},
	hydrate: (map) => set({ minimized: { ...map } }),
	setMinimized: (sessionId, value) =>
		set((s) => {
			const current = s.minimized[sessionId] ?? false;
			if (current === value) return s;
			// Fire-and-forget IPC. Main persists, then broadcasts
			// `state:changed` to every other window (skip-self) which triggers
			// their refetch.
			void window.claude?.setMinimized(sessionId, value);
			const next = { ...s.minimized };
			if (value) {
				next[sessionId] = true;
			} else {
				delete next[sessionId];
			}
			return { minimized: next };
		}),
}));
