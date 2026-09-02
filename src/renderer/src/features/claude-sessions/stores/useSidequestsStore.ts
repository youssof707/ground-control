import { create } from "zustand";
import type {
	SessionMessage,
	SessionMode,
	SessionStatus,
} from "@shared/claude-sessions/types";

/**
 * Sidequests are ephemeral forks of a main session, used for throw-away
 * questions ("what does this stand for?") that shouldn't pollute the main
 * thread's context. App-side they exist only in memory — in this store on the
 * renderer side, and as a `RunningEntry` plus a `SidequestRun` in the main
 * process's SessionManager. Nothing is written to `claude_sessions.json`.
 *
 * The SDK branch *does* get a transcript in `~/.claude/projects`, because
 * forking a sidequest into a real session (the panel's Fork action, main's
 * `promoteSidequest`) can only branch from a transcript on disk.
 * `discardSidequest` deletes it again unless it was promoted.
 *
 * Keyed by *parent* session id: at most one sidequest per main session, kept
 * alive across navigation so switching sessions and coming back preserves the
 * transcript. Fed entirely by `sidequest:*` broadcasts (including the user's
 * own turns, which main echoes back) — there is no optimistic local append.
 */
// Canonical definitions live in `@shared` so the main process can use the
// same prefix check before writing to the session store. Re-exported here
// because every existing renderer call site imports them from this module.
export {
	SIDEQUEST_ID_PREFIX,
	isSidequestId,
	newSidequestId,
} from "@shared/claude-sessions/sidequest";

export interface SidequestState {
	sidequestId: string;
	parentSessionId: string;
	/** Wrapper message id in the parent thread this sidequest branched at. */
	forkMessageId: string;
	messages: SessionMessage[];
	/** "starting" covers the window between the IPC call and `sidequest:started`. */
	status: "starting" | SessionStatus;
	/**
	 * Permission mode, seeded from the parent at fork time and thereafter
	 * owned by this store: main applies mode changes to the live SDK query
	 * only (persisting would mint a ghost sidebar row), so there is no
	 * persisted record to reconcile against. Kept in sync with main via
	 * `sidequest:patch`, which also carries the ExitPlanMode auto-flip.
	 */
	mode: SessionMode;
	/** Model override, or undefined = the CLI default. Same ownership story. */
	model?: string;
	/** When the override was last requested — gates the "pending" label. */
	modelChangedAt?: number;
	error?: string;
	createdAt: number;
}

interface State {
	byParent: Record<string, SidequestState>;
	/**
	 * Bumped whenever something wants the sidequest composer focused with the
	 * caret at the end (Cmd+S, Clear). The panel watches this rather than a
	 * boolean so repeated requests always re-fire.
	 */
	focusNonce: number;
	register: (input: {
		sidequestId: string;
		parentSessionId: string;
		forkMessageId: string;
		mode: SessionMode;
		model?: string;
	}) => void;
	upsertFromStarted: (input: {
		parentSessionId: string;
		sidequestId: string;
		mode: SessionMode;
		model?: string;
	}) => void;
	appendMessage: (sidequestId: string, message: SessionMessage) => void;
	/** Apply a `sidequest:patch` (mode / model sync from main). */
	patch: (
		sidequestId: string,
		fields: { mode?: SessionMode; model?: string; modelChangedAt?: number },
	) => void;
	setStatus: (sidequestId: string, status: SessionStatus) => void;
	setError: (sidequestId: string, error: string) => void;
	discard: (parentSessionId: string) => void;
	parentOf: (sidequestId: string) => string | undefined;
	bumpFocus: () => void;
}

export const useSidequestsStore = create<State>((set, get) => ({
	byParent: {},
	focusNonce: 0,

	// Called by the renderer *before* invoking `sidequest:start`, using an id
	// it minted itself. That gives the panel an instant "starting" state and
	// removes any race with the synchronous `sidequest:started` broadcast.
	register: ({ sidequestId, parentSessionId, forkMessageId, mode, model }) =>
		set((s) => ({
			byParent: {
				...s.byParent,
				[parentSessionId]: {
					sidequestId,
					parentSessionId,
					forkMessageId,
					messages: [],
					status: "starting",
					// Seeded from the parent so the composer's toggle and model
					// label are correct during the "starting" window, before
					// `sidequest:started` echoes main's copy of the same values.
					mode,
					model,
					createdAt: Date.now(),
				},
			},
		})),

	// `sidequest:started` only confirms what `register` already recorded, so
	// this is a no-op unless the entry went missing (other window, reload).
	upsertFromStarted: ({ parentSessionId, sidequestId, mode, model }) =>
		set((s) => {
			const prev = s.byParent[parentSessionId];
			if (prev?.sidequestId === sidequestId) {
				return {
					byParent: {
						...s.byParent,
						[parentSessionId]: {
							...prev,
							status: "idle",
							mode,
							model,
							// A sidequest that just started successfully has no
							// error — without this the banner from a previous
							// failed start outlives the fork that fixed it.
							error: undefined,
						},
					},
				};
			}
			return {
				byParent: {
					...s.byParent,
					[parentSessionId]: {
						sidequestId,
						parentSessionId,
						forkMessageId: prev?.forkMessageId ?? "",
						messages: [],
						status: "idle",
						mode,
						model,
						createdAt: Date.now(),
					},
				},
			};
		}),

	appendMessage: (sidequestId, message) =>
		set((s) => {
			const parentId = findParent(s.byParent, sidequestId);
			if (!parentId) return s;
			const sq = s.byParent[parentId];
			// Dedupe by message id — a refetch or double-broadcast must not
			// duplicate a turn in the transcript.
			if (sq.messages.some((m) => m.id === message.id)) return s;
			return {
				byParent: {
					...s.byParent,
					[parentId]: { ...sq, messages: [...sq.messages, message] },
				},
			};
		}),

	// `model` is intentionally assigned unconditionally when the key is
	// present: `undefined` is a meaningful value (clear the override), so a
	// `?? prev` fallback would make "switch back to Default" impossible.
	patch: (sidequestId, fields) =>
		set((s) => {
			const parentId = findParent(s.byParent, sidequestId);
			if (!parentId) return s;
			const sq = s.byParent[parentId];
			return {
				byParent: {
					...s.byParent,
					[parentId]: {
						...sq,
						...("mode" in fields && fields.mode ? { mode: fields.mode } : {}),
						...("model" in fields ? { model: fields.model } : {}),
						...("modelChangedAt" in fields
							? { modelChangedAt: fields.modelChangedAt }
							: {}),
					},
				},
			};
		}),

	setStatus: (sidequestId, status) =>
		set((s) => {
			const parentId = findParent(s.byParent, sidequestId);
			if (!parentId) return s;
			return {
				byParent: {
					...s.byParent,
					[parentId]: { ...s.byParent[parentId], status },
				},
			};
		}),

	setError: (sidequestId, error) =>
		set((s) => {
			const parentId = findParent(s.byParent, sidequestId);
			if (!parentId) return s;
			return {
				byParent: {
					...s.byParent,
					[parentId]: { ...s.byParent[parentId], status: "errored", error },
				},
			};
		}),

	discard: (parentSessionId) =>
		set((s) => {
			if (!(parentSessionId in s.byParent)) return s;
			const rest = { ...s.byParent };
			delete rest[parentSessionId];
			return { byParent: rest };
		}),

	parentOf: (sidequestId) => findParent(get().byParent, sidequestId),

	bumpFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
}));

/**
 * Reverse lookup: broadcasts are keyed by sidequest id, the store by parent id.
 * At most one sidequest per parent and rarely more than a handful of parents,
 * so a linear scan is cheaper than maintaining a second index.
 */
function findParent(
	byParent: Record<string, SidequestState>,
	sidequestId: string,
): string | undefined {
	for (const [parentId, sq] of Object.entries(byParent)) {
		if (sq.sidequestId === sidequestId) return parentId;
	}
	return undefined;
}
