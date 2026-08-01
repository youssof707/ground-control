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
	/** App-owned worktree attached to this draft. Set to a Worktree.id
	 * when the user picks / creates one via AttachWorktreeModal; cleared
	 * to `undefined` when the user changes cwd (worktree is bound to a
	 * baseDir) or clicks ✕ on the chip. On send, this id is forwarded to
	 * `startSession`, at which point the SessionManager persists the
	 * binding onto the created session record. */
	worktreeId?: string;
	/** Optional model override chosen in the draft header. Undefined = use
	 * the CLI default. Forwarded to `startSession` on first send;
	 * SessionManager stamps it onto the created session record and hands
	 * it to the SDK loop. Same id space as `session.model` (bare aliases
	 * like `sonnet`, `fable`, or full SDK ids like `claude-sonnet-4-5-…`),
	 * validated for real by the SDK on the first turn. */
	model?: string;
}

interface State {
	draft: DraftSession | null;
	createDraft: (input: {
		cwd: string;
		title: string;
		mode?: SessionMode;
	}) => DraftSession;
	// The patch type intentionally allows `worktreeId: undefined` and
	// `model: undefined` so the folder-change handler can clear the
	// worktree binding, and the model picker can clear the override back
	// to the CLI default, in the same call shape.
	updateDraft: (
		patch: Partial<
			Pick<DraftSession, "cwd" | "title" | "mode" | "worktreeId" | "model">
		>,
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
