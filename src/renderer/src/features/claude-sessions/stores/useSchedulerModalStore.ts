import { create } from "zustand";

interface State {
	isOpen: boolean;
	editScheduleId?: string;
	open: () => void;
	openEdit: (scheduleId: string) => void;
	close: () => void;
}

export const useSchedulerModalStore = create<State>((set) => ({
	isOpen: false,
	editScheduleId: undefined,
	open: () => set({ isOpen: true, editScheduleId: undefined }),
	openEdit: (scheduleId) => set({ isOpen: true, editScheduleId: scheduleId }),
	close: () => set({ isOpen: false, editScheduleId: undefined }),
}));
