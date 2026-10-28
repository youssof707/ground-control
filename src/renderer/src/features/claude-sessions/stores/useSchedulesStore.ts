import { create } from "zustand";
import type { Schedule } from "@shared/schemas/schedules";

interface State {
	byId: Record<string, Schedule>;
	hydrate: (list: Schedule[]) => void;
	upsert: (s: Schedule) => void;
	remove: (id: string) => void;
}

export const useSchedulesStore = create<State>((set) => ({
	byId: {},
	hydrate: (list) => {
		const map: Record<string, Schedule> = {};
		for (const s of list) map[s.id] = s;
		set({ byId: map });
	},
	upsert: (s) => set((state) => ({ byId: { ...state.byId, [s.id]: s } })),
	remove: (id) =>
		set((state) => {
			if (!(id in state.byId)) return state;
			const next = { ...state.byId };
			delete next[id];
			return { byId: next };
		}),
}));
