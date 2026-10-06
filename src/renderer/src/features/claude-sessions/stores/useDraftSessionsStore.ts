import { create } from "zustand";
import type { SessionMode } from "@shared/claude-sessions/types";
import { appDefaultModel } from "./useSettingsStore";

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
	/** Optional model override chosen in the draft header, or seeded from
	 * the app-wide default model (Settings) at draft creation. Undefined =
	 * use the CLI default. Forwarded to `startSession` on first send;
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
	/** Set by the plain top-of-sidebar New Session button (and Cmd+N): the
	 * draft isn't tied to any sidebar container yet, so its row renders at
	 * the top of the list instead of inside its cwd bucket. A group or
	 * worktree binding still wins (see `draftHost` in SessionsList), and the
	 * per-bucket "+" retargets clear it. UI-only — never forwarded to
	 * `startSession`. */
	floating?: boolean;
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
		floating?: boolean;
	}) => DraftSession;
	// The patch type intentionally allows `worktreeId: undefined`,
	// `model: undefined`, and `groupId: undefined` so callers can clear a
	// prior binding (folder change, model picker reset) in the same call
	// shape.
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
				| "floating"
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
	createDraft: ({
		cwd,
		defaultTitle,
		mode = "plan",
		worktreeId,
		groupId,
		floating,
	}) => {
		const draft: DraftSession = {
			id: `draft-${crypto.randomUUID()}`,
			cwd,
			title: "",
			defaultTitle,
			mode,
			createdAt: Date.now(),
			worktreeId,
			groupId,
			floating,
			// Seed the app-wide default so the chip in the draft header shows
			// the model BEFORE the first send — an invisible main-side
			// substitution would make the header lie. Undefined when no
			// default is set, which is the pre-existing "omit `model`"
			// behaviour. Callers that mean to inherit a different model
			// (handoffActions) overwrite this with an explicit updateDraft
			// patch after createDraft returns.
			model: appDefaultModel(),
		};
		set({ draft });
		return draft;
	},
	updateDraft: (patch) =>
		set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
	discardDraft: () => set({ draft: null }),
}));
