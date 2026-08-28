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
	/** Name the user typed into the draft header's name box. Empty string
	 * means "not named" — the box shows its placeholder, the sidebar row
	 * falls back to `defaultTitle`, and on first send the session is created
	 * unlocked so SessionManager derives a title from that first message
	 * (the long-standing default behaviour). A non-empty value is sent with
	 * `titleLocked: true` and is never auto-changed afterwards. */
	title: string;
	/** Generated `Session N` placeholder, stamped once at draft creation.
	 * Used as the sidebar display fallback and as the provisional title sent
	 * to `startSession` when `title` is blank — so the row is never
	 * titleless in the beat before the derived title arrives. */
	defaultTitle: string;
	mode: SessionMode;
	createdAt: number;
	/** App-owned worktree attached to this draft. Set to a Worktree.id
	 * when the user picks / creates one via AttachWorktreeModal, or
	 * pre-seeded by the sidebar worktree group's "+" button; cleared
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
	/** Sidebar group inherited from a handoff's source session. Forwarded to
	 * `startSession` on first send; SessionManager stamps it onto the
	 * created record so the replacement is born inside the group — no
	 * post-hoc regroup, and no window in which `pruneGroupIfEmpty` could
	 * delete the group during a "Handoff & delete". */
	groupId?: string;
	/** Deferred half of "Handoff & delete": the session to delete once —
	 * and only once — this draft is promoted AND its first turn lands. If
	 * the user never sends, the source session survives. Every retarget
	 * site that repurposes the shared draft slot for a different intent
	 * (New Session, shortcuts) must explicitly clear this to `undefined` —
	 * otherwise an abandoned handoff's delete can ride along onto an
	 * unrelated later draft. */
	handoffDeleteSessionId?: string;
}

interface State {
	draft: DraftSession | null;
	createDraft: (input: {
		cwd: string;
		defaultTitle: string;
		mode?: SessionMode;
		worktreeId?: string;
		/** Sidebar group the draft is filed into at birth. Seeded by the group
		 * header's "+" so the row lands inside that group's box and the real
		 * session is BORN in the group on first send — same "born-with, not
		 * set post-hoc" rule the handoff flow relies on. */
		groupId?: string;
	}) => DraftSession;
	// The patch type intentionally allows `worktreeId: undefined`,
	// `model: undefined`, `groupId: undefined`, and
	// `handoffDeleteSessionId: undefined` so callers can clear a prior
	// binding (folder change, model picker reset, or a retarget site
	// disowning a stale handoff-delete) in the same call shape.
	updateDraft: (
		patch: Partial<
			Pick<
				DraftSession,
				| "cwd"
				| "title"
				| "mode"
				| "worktreeId"
				| "model"
				| "groupId"
				| "handoffDeleteSessionId"
			>
		>,
	) => void;
	discardDraft: () => void;
}

export function isDraftId(id: string | undefined | null): id is string {
	return !!id && id.startsWith("draft-");
}

export const useDraftSessionsStore = create<State>((set) => ({
	draft: null,
	createDraft: ({ cwd, defaultTitle, mode = "plan", worktreeId, groupId }) => {
		const draft: DraftSession = {
			id: `draft-${crypto.randomUUID()}`,
			cwd,
			title: "",
			defaultTitle,
			mode,
			createdAt: Date.now(),
			worktreeId,
			groupId,
		};
		set({ draft });
		return draft;
	},
	updateDraft: (patch) =>
		set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
	discardDraft: () => set({ draft: null }),
}));
