import { create } from "zustand";

interface State {
	/** Session id the model picker is open for, or null when closed. The
	 * modal instance itself still lives inside SessionTokenBar (it needs
	 * `session` for the effective-model highlight) — this store only carries
	 * the open/closed signal, so triggers outside that component's subtree
	 * (the global Cmd+Shift+M hotkey, the composer's model chip next to the
	 * Stop pill) can open it too. Same reasoning as `useCommandPaletteStore` /
	 * `useRightPanelStore`. */
	openForSessionId: string | null;
	open: (sessionId: string) => void;
	close: () => void;
}

export const useModelPickerStore = create<State>((set) => ({
	openForSessionId: null,
	open: (sessionId) => set({ openForSessionId: sessionId }),
	close: () => set({ openForSessionId: null }),
}));
