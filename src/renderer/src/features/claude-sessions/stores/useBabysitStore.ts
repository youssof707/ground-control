import { create } from "zustand";
import type { BabysitConfig } from "@shared/claude-sessions/babysit";

interface State {
	/**
	 * Sessions currently being babysat, keyed by session id. A mirror of the
	 * Map main's `Babysitter` owns — main makes every decision; this exists so
	 * the sidebar badge and the modal can render. Fed by the `babysit:changed`
	 * broadcast and re-primed from `babysit:list` on bootstrap (see
	 * `useSessionsBootstrap`).
	 *
	 * Pure in-memory on both sides: no persist middleware here, no store file
	 * in main. Babysitting ends when the app quits.
	 *
	 * A session that isn't being babysat has NO entry (rather than an entry
	 * of all-"none" rules), so `!!bySession[id]` is the "is it on" check.
	 */
	bySession: Record<string, BabysitConfig>;
	/**
	 * Session whose Babysitter modal is open, or null. Lives here rather than
	 * in `SessionsList`'s local state because two unrelated things open it —
	 * the row's ⋯ menu and the row's badge — same "signal outside the
	 * component subtree" reasoning as `useModelPickerStore`.
	 */
	modalSessionId: string | null;
	hydrate: (bySession: Record<string, BabysitConfig>) => void;
	apply: (sessionId: string, config: BabysitConfig | null) => void;
	openModal: (sessionId: string) => void;
	closeModal: () => void;
}

export const useBabysitStore = create<State>((set) => ({
	bySession: {},
	modalSessionId: null,
	hydrate: (bySession) => set({ bySession }),
	apply: (sessionId, config) =>
		set((s) => {
			if (config) {
				return { bySession: { ...s.bySession, [sessionId]: config } };
			}
			if (!s.bySession[sessionId]) return s;
			// Delete rather than keep an "off" entry — the map is read as
			// `!!map[id]`, and tombstones would grow it for the app's lifetime.
			const next = { ...s.bySession };
			delete next[sessionId];
			return { bySession: next };
		}),
	openModal: (sessionId) => set({ modalSessionId: sessionId }),
	closeModal: () => set({ modalSessionId: null }),
}));
