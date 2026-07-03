import { create } from "zustand";
import type { SessionMode } from "@shared/claude-sessions/types";

/**
 * Single-slot in-memory store for the "draft session" — a session the user
 * has begun composing but has not yet sent a first message in. A draft is
 * created when the user clicks New Session and replaced/promoted by a real
 * session id on first send.
 *
 * Per product decisions:
 *   - At most ONE draft exists at a time. A second click of New Session
 *     navigates back into the existing draft rather than creating another.
 *   - Drafts auto-discard when the user navigates away from an empty draft
 *     (no text, no images). Explicit "Discard" is also available from the
 *     sidebar row's ⋯ menu.
 *   - Drafts live for the renderer process only — no persistence. This
 *     matches the sibling `useDraftStore` (text+images per session).
 *
 * Draft IDs are prefixed with `draft-` so any code path can distinguish them
 * from real session ids via `isDraftId`.
 */
export interface DraftSession {
	id: string;
	cwd: string;
	title: string;
	mode: SessionMode;
	createdAt: number;
}

interface State {
	draft: DraftSession | null;
	createDraft: (input: {
		cwd: string;
		title: string;
		mode?: SessionMode;
	}) => DraftSession;
	updateDraft: (
		patch: Partial<Pick<DraftSession, "cwd" | "title" | "mode">>,
	) => void;
	discardDraft: () => void;
}

export function isDraftId(id: string | undefined | null): id is string {
	return !!id && id.startsWith("draft-");
}

export const useDraftSessionsStore = create<State>((set) => ({
	draft: null,
	createDraft: ({ cwd, title, mode = "plan" }) => {
		const draft: DraftSession = {
			id: `draft-${crypto.randomUUID()}`,
			cwd,
			title,
			mode,
			createdAt: Date.now(),
		};
		set({ draft });
		return draft;
	},
	updateDraft: (patch) =>
		set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
	discardDraft: () => set({ draft: null }),
}));
