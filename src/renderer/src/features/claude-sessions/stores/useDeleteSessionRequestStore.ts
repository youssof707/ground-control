import { create } from "zustand";

interface State {
	requestedSessionId: string | null;
	request: (sessionId: string) => void;
	clear: () => void;
}

export const useDeleteSessionRequestStore = create<State>((set) => ({
	requestedSessionId: null,
	request: (sessionId) => set({ requestedSessionId: sessionId }),
	clear: () => set({ requestedSessionId: null }),
}));
