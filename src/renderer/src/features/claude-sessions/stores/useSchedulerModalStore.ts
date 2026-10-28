import { create } from "zustand";

export type SchedulerTab = "schedules" | "sessions";

interface State {
	openTab: SchedulerTab | null;
	open: (tab?: SchedulerTab) => void;
	close: () => void;
}

export const useSchedulerModalStore = create<State>((set) => ({
	openTab: null,
	open: (tab = "schedules") => set({ openTab: tab }),
	close: () => set({ openTab: null }),
}));
