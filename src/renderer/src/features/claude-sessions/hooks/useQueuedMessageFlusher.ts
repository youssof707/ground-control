import { useEffect } from "react";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { sendTurn } from "../lib/sendTurn";

/**
 * App-level (not composer-level) owner of "fire the queued pre-move the
 * instant this session's turn is completely done". Mounted once in
 * `MainApp`, alongside `useSessionsBootstrap`, so a queued message still
 * fires after the user has navigated away from the session that queued it.
 *
 * "Completely done" is `running → idle` with no permission request pending
 * for that session. `awaiting_permission` is never a backend status (see
 * `SessionManager.syncStatus` / `sessionActivity.ts`) — while a permission,
 * plan approval, or ask-user-question card is open the SDK turn hasn't
 * produced a `result` yet, so status stays `running` and this effect simply
 * never sees an `idle` edge to act on. The `usePermissionsStore` check below
 * is defense-in-depth against a hydration race, not the primary gate.
 *
 * Interrupting (Stop) also drives status to `idle`, but that's the user
 * saying "wait", not "the turn finished" — `SessionChat.stop()` calls
 * `useQueuedMessagesStore.getState().hold(sessionId)` before interrupting,
 * so the `heldSessions` check here keeps the queue parked until a fresh turn
 * starts and clears the latch.
 */
export function useQueuedMessageFlusher() {
	useEffect(() => {
		if (!window.claude) return;

		// Sessions currently being flushed, so a rapid-fire status flap can't
		// send the same head message twice while its `sendTurn` is in flight.
		const inFlight = new Set<string>();

		const tryFlush = (sessionId: string) => {
			const { heldSessions, queuesBySession } = useQueuedMessagesStore.getState();
			if (heldSessions[sessionId]) return;
			if (inFlight.has(sessionId)) return;
			const pendingPermission = usePermissionsStore
				.getState()
				.queue.some((q) => q.sessionId === sessionId);
			if (pendingPermission) return;
			const queue = queuesBySession[sessionId];
			if (!queue || queue.length === 0) return;

			const msg = useQueuedMessagesStore.getState().shift(sessionId);
			if (!msg) return;
			inFlight.add(sessionId);
			sendTurn(sessionId, msg.blocks)
				.catch((err) => {
					// Put it back at the head and latch the queue so we don't
					// immediately retry against a session that just proved it
					// can't accept a turn right now.
					useQueuedMessagesStore.getState().unshift(sessionId, msg);
					useQueuedMessagesStore
						.getState()
						.setError(
							sessionId,
							err instanceof Error ? err.message : String(err),
						);
					useQueuedMessagesStore.getState().hold(sessionId);
				})
				.finally(() => {
					inFlight.delete(sessionId);
				});
		};

		const unsubscribe = useSessionsStore.subscribe((state, prevState) => {
			for (const id of state.order) {
				const prevStatus = prevState.sessions[id]?.status;
				const nextStatus = state.sessions[id]?.status;
				if (prevStatus === nextStatus) continue;
				if (nextStatus === "running") {
					// A new turn started (manual send, resume, or a flushed
					// message) — any interrupt latch from a previous turn no
					// longer applies.
					useQueuedMessagesStore.getState().release(id);
				} else if (prevStatus === "running" && nextStatus === "idle") {
					tryFlush(id);
				}
			}
			// A session dropped out of the store entirely (deleted/archived) —
			// stop holding a queue for it.
			for (const id of Object.keys(
				useQueuedMessagesStore.getState().queuesBySession,
			)) {
				if (!state.sessions[id]) {
					useQueuedMessagesStore.getState().clearSession(id);
				}
			}
		});

		return unsubscribe;
	}, []);
}
