import { create } from "zustand";

/**
 * What picking a shortcut/skill from the palette should do: start a fresh
 * session (mirrors the sidebar's ⚡ button) or insert into a specific,
 * already-open session's composer (mirrors that composer's own ⚡ button).
 */
export type PaletteTarget =
	| { kind: "new-session" }
	| { kind: "insert"; sessionId: string };

interface State {
	open: boolean;
	target: PaletteTarget;
	openPalette: (target: PaletteTarget) => void;
	close: () => void;
}

/**
 * Lifted out to a store — same reason as `useRightPanelStore` — so the
 * global Cmd+K handler can open the picker from a window keydown listener
 * outside the component tree, and so a single modal instance (mounted once
 * in MainApp) can serve both the "no composer focused" and "composer
 * focused" cases without either the sidebar or the composer owning it.
 */
export const useCommandPaletteStore = create<State>((set) => ({
	open: false,
	target: { kind: "new-session" },
	openPalette: (target) => set({ open: true, target }),
	close: () => set({ open: false }),
}));
