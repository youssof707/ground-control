import { create } from "zustand";
import type { UserContentBlock } from "@shared/claude-sessions/types";

/**
 * A message queued from the composer while its session was running — a
 * chess-style "pre-move" that fires the instant the session's current turn
 * is *completely* done (status goes to `idle` with no permission prompt
 * pending), not merely when it stops streaming output.
 */
export interface QueuedMessage {
	id: string;
	blocks: UserContentBlock[];
	/** Trimmed text for the chip. Empty when the message is images-only. */
	preview: string;
	imageCount: number;
}

interface State {
	/**
	 * FIFO per session. Today's UI only ever lets one message be queued at a
	 * time (the composer disables "Queue message" while a queue is
	 * non-empty), but the store itself is already a queue so a future
	 * multi-message UI needs no data-model change — see
	 * `useQueuedMessageFlusher`, which fires the head and lets the next
	 * `running → idle` edge pick up whatever's left.
	 */
	queuesBySession: Record<string, QueuedMessage[]>;
	/**
	 * Sessions whose queue is latched shut because the user hit Stop.
	 * Interrupting drives status to `idle` too, but that's not "the turn
	 * finished" — it's "the user said wait". Cleared the moment the session
	 * next goes `running` (a fresh turn, manual or flushed, makes the old
	 * interrupt moot).
	 */
	heldSessions: Record<string, true>;
	/** Last flush failure per session, surfaced on the chip. */
	errorsBySession: Record<string, string>;

	enqueue: (sessionId: string, msg: QueuedMessage) => void;
	/** Pop the head. Returns undefined if the queue is empty. */
	shift: (sessionId: string) => QueuedMessage | undefined;
	/** Push a message back at the head — used to undo a failed flush. */
	unshift: (sessionId: string, msg: QueuedMessage) => void;
	cancel: (sessionId: string, messageId: string) => void;
	clearSession: (sessionId: string) => void;
	hold: (sessionId: string) => void;
	release: (sessionId: string) => void;
	setError: (sessionId: string, err: string | null) => void;
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

export const useQueuedMessagesStore = create<State>((set, get) => ({
	queuesBySession: {},
	heldSessions: {},
	errorsBySession: {},

	enqueue: (sessionId, msg) =>
		set((s) => {
			const existing = s.queuesBySession[sessionId] ?? [];
			return {
				queuesBySession: {
					...s.queuesBySession,
					[sessionId]: [...existing, msg],
				},
			};
		}),

	shift: (sessionId) => {
		const existing = get().queuesBySession[sessionId] ?? [];
		if (existing.length === 0) return undefined;
		const [head, ...rest] = existing;
		set((s) => ({
			queuesBySession:
				rest.length > 0
					? { ...s.queuesBySession, [sessionId]: rest }
					: withoutKey(s.queuesBySession, sessionId),
		}));
		return head;
	},

	unshift: (sessionId, msg) =>
		set((s) => {
			const existing = s.queuesBySession[sessionId] ?? [];
			return {
				queuesBySession: {
					...s.queuesBySession,
					[sessionId]: [msg, ...existing],
				},
			};
		}),

	cancel: (sessionId, messageId) =>
		set((s) => {
			const existing = s.queuesBySession[sessionId];
			if (!existing) return s;
			const next = existing.filter((m) => m.id !== messageId);
			return {
				queuesBySession:
					next.length > 0
						? { ...s.queuesBySession, [sessionId]: next }
						: withoutKey(s.queuesBySession, sessionId),
			};
		}),

	clearSession: (sessionId) =>
		set((s) => ({
			queuesBySession: withoutKey(s.queuesBySession, sessionId),
			heldSessions: withoutKey(s.heldSessions, sessionId),
			errorsBySession: withoutKey(s.errorsBySession, sessionId),
		})),

	hold: (sessionId) =>
		set((s) => ({
			heldSessions: { ...s.heldSessions, [sessionId]: true },
		})),

	release: (sessionId) =>
		set((s) => ({
			heldSessions: withoutKey(s.heldSessions, sessionId),
		})),

	setError: (sessionId, err) =>
		set((s) => ({
			errorsBySession:
				err === null
					? withoutKey(s.errorsBySession, sessionId)
					: { ...s.errorsBySession, [sessionId]: err },
		})),
}));
