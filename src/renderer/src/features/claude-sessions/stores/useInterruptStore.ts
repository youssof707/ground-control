import { create } from "zustand";

interface State {
	/**
	 * Session ids with an interrupt request in flight. Lifted out of
	 * `SessionChat`'s local state so the composer's Stop pill and the global
	 * ⌘. hotkey share one re-entrancy guard — as component state they'd each
	 * have their own, and pressing ⌘. while the button was mid-request (or
	 * vice versa) would fire a second `interruptSession` and a second
	 * `hold()`. Same "signal outside the component subtree" reasoning as
	 * `useModelPickerStore` / `useCommandPaletteStore`.
	 *
	 * Keyed by session id rather than a single boolean because several
	 * sessions can be running at once; only the one being stopped should show
	 * "Stopping…".
	 */
	interrupting: Record<string, boolean>;
	begin: (sessionId: string) => void;
	end: (sessionId: string) => void;
}

export const useInterruptStore = create<State>((set) => ({
	interrupting: {},
	begin: (sessionId) =>
		set((s) => ({ interrupting: { ...s.interrupting, [sessionId]: true } })),
	end: (sessionId) =>
		set((s) => {
			// Delete rather than set false — the map is read as `!!map[id]`, and
			// leaving tombstones would grow it for the lifetime of the app.
			const next = { ...s.interrupting };
			delete next[sessionId];
			return { interrupting: next };
		}),
}));
