import { create } from "zustand";

/**
 * Discriminated state for the right-hand panel. Inbox, Notes and Sidequest
 * share one slot and are mutually exclusive — opening one closes the others.
 * `null` means no right panel is open.
 */
export type RightPanel = "inbox" | "notes" | "sidequest" | null;

interface State {
	rightPanel: RightPanel;
	setRightPanel: (v: RightPanel) => void;
}

/**
 * Lifted out of `MainApp`'s local `useState` so non-React callers can open a
 * panel — specifically the global Cmd+S handler, which runs from a window
 * keydown listener and has no access to the component tree.
 */
export const useRightPanelStore = create<State>((set) => ({
	rightPanel: null,
	setRightPanel: (v) => set({ rightPanel: v }),
}));
