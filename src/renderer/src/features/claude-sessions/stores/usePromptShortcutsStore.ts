import { create } from "zustand";
import type { PromptShortcut } from "@shared/schemas/promptShortcuts";

/**
 * Pure cache of saved in-session prompt shortcuts, mirroring
 * useShortcutsStore: no IPC in here. Hydrated by useSessionsBootstrap;
 * mutations are invoked from components which then upsert/remove with the
 * invoke response (main's `state:changed` broadcast is skip-self).
 */
interface State {
	promptShortcuts: Record<string, PromptShortcut>;
	hydrate: (list: PromptShortcut[]) => void;
	upsert: (s: PromptShortcut) => void;
	remove: (id: string) => void;
}

export const usePromptShortcutsStore = create<State>((set) => ({
	promptShortcuts: {},
	hydrate: (list) => {
		const map: Record<string, PromptShortcut> = {};
		for (const s of list) {
			map[s.id] = s;
		}
		set({ promptShortcuts: map });
	},
	upsert: (s) =>
		set((state) => ({
			promptShortcuts: { ...state.promptShortcuts, [s.id]: s },
		})),
	remove: (id) =>
		set((state) => {
			if (!(id in state.promptShortcuts)) return state;
			const next = { ...state.promptShortcuts };
			delete next[id];
			return { promptShortcuts: next };
		}),
}));
