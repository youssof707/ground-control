import { create } from "zustand";
import type { Shortcut } from "@shared/schemas/shortcuts";

/**
 * Pure cache of saved session shortcuts, mirroring useSessionGroupsStore:
 * no IPC in here. Hydrated by useSessionsBootstrap; mutations are invoked
 * from components which then upsert/remove with the invoke response
 * (main's `state:changed` broadcast is skip-self).
 */
interface State {
	shortcuts: Record<string, Shortcut>;
	hydrate: (list: Shortcut[]) => void;
	upsert: (s: Shortcut) => void;
	remove: (id: string) => void;
}

export const useShortcutsStore = create<State>((set) => ({
	shortcuts: {},
	hydrate: (list) => {
		const map: Record<string, Shortcut> = {};
		for (const s of list) {
			map[s.id] = s;
		}
		set({ shortcuts: map });
	},
	upsert: (s) =>
		set((state) => ({ shortcuts: { ...state.shortcuts, [s.id]: s } })),
	remove: (id) =>
		set((state) => {
			if (!(id in state.shortcuts)) return state;
			const next = { ...state.shortcuts };
			delete next[id];
			return { shortcuts: next };
		}),
}));
