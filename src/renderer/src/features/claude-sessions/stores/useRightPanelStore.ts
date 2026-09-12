import { create } from "zustand";

/**
 * The right-hand panel slot. Only one panel is ever on screen — all three are
 * `flexShrink: 0` siblings in `MainBody`'s flex row, so rendering two would
 * squash the transcript.
 *
 * Notes and Sidequest are session-scoped: their *contents* are already keyed by
 * session id (`useSessionNotesStore.notesBySession`, `useSidequestsStore.byParent`),
 * so their open/closed choice is too. Inbox is genuinely app-global and
 * *overlays* — opening it hides the session's panel without forgetting it.
 */
export type SessionPanel = "notes" | "sidequest";
export type RightPanel = "inbox" | SessionPanel | null;

interface State {
	inboxOpen: boolean;
	/**
	 * Absent key = that session's panel is closed. In-memory only — the
	 * sidequest transcript itself dies on reload, so persisting "open" would
	 * restore an empty panel.
	 *
	 * Never pruned on session delete. Entries are interned strings and only
	 * exist while a panel is actually open (closing deletes the key), so the
	 * map stays bounded by "sessions with a panel open right now".
	 */
	panelBySession: Record<string, SessionPanel>;
	setInboxOpen: (v: boolean) => void;
	/** `null` closes. Non-null also closes the Inbox — it overlays, not replaces. */
	setSessionPanel: (sessionId: string, v: SessionPanel | null) => void;
	/** Re-key when a draft session is promoted to a real id. */
	moveSession: (from: string, to: string) => void;
}

function withoutKey<T>(
	rec: Record<string, T>,
	key: string,
): Record<string, T> {
	if (!(key in rec)) return rec;
	const rest = { ...rec };
	delete rest[key];
	return rest;
}

/**
 * Lifted out of `MainApp`'s local `useState` so non-React callers can open a
 * panel — specifically the global Cmd+S handler, which runs from a window
 * keydown listener and has no access to the component tree.
 */
export const useRightPanelStore = create<State>((set) => ({
	inboxOpen: false,
	panelBySession: {},
	setInboxOpen: (v) => set({ inboxOpen: v }),
	setSessionPanel: (sessionId, v) =>
		set((s) =>
			v === null
				? { panelBySession: withoutKey(s.panelBySession, sessionId) }
				: {
					panelBySession: { ...s.panelBySession, [sessionId]: v },
					inboxOpen: false,
				},
		),
	moveSession: (from, to) =>
		set((s) => {
			const panel = s.panelBySession[from];
			if (!panel) return s;
			return {
				panelBySession: {
					...withoutKey(s.panelBySession, from),
					[to]: panel,
				},
			};
		}),
}));

/**
 * The one panel actually on screen. Inbox wins while it's open — it overlays
 * the session's panel rather than replacing it, so closing the Inbox brings the
 * session's panel back.
 *
 * Two separate selectors, both returning primitives: zustand v5 dropped the
 * default shallow compare, so a combined object selector would allocate every
 * render and trip the "getSnapshot should be cached" loop.
 *
 * Returns `null` for the session arms when there's no active session, which is
 * why there's no auto-close effect anywhere — rendering a session panel with an
 * undefined session id is structurally impossible.
 */
export function useActiveRightPanel(sessionId: string | undefined): RightPanel {
	const inboxOpen = useRightPanelStore((s) => s.inboxOpen);
	const sessionPanel = useRightPanelStore((s) =>
		sessionId ? (s.panelBySession[sessionId] ?? null) : null,
	);
	return inboxOpen ? "inbox" : sessionPanel;
}
