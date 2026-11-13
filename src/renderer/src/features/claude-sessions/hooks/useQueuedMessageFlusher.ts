import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import {
	useQueuedMessagesStore,
	type QueuedMessage,
} from "../stores/useQueuedMessagesStore";
import { isSidequestId, useSidequestsStore } from "../stores/useSidequestsStore";
import { sendTurn } from "../lib/sendTurn";
import { sendToSidequest } from "../lib/sidequestActions";
import { applyModelForMessage } from "../lib/modelSwitchActions";
import { useModelPickerStore } from "../stores/useModelPickerStore";
import { handoffReplyText } from "../lib/handoffCommand";
import { runHandoff } from "../lib/handoffActions";

/**
 * App-level (not composer-level) owner of "fire the queued pre-move the
 * instant this session's turn is completely done". Mounted once in
 * `MainApp`, alongside `useSessionsBootstrap`, so a queued message still
 * fires after the user has navigated away from the session that queued it.
 *
 * Watches two stores, symmetrically: `useSessionsStore` for real/draft-then-
 * promoted sessions, and `useSidequestsStore` for sidequests (their own
 * ephemeral status, keyed by *parent* id there but by the sidequest's own id
 * here, same as everywhere else in the composer).
 *
 * "Completely done" is `running → idle` with no permission request pending
 * for that id. `awaiting_permission` is never a backend status (see
 * `SessionManager.syncStatus` / `sessionActivity.ts`) — while a permission,
 * plan approval, or ask-user-question card is open the SDK turn hasn't
 * produced a `result` yet, so status stays `running` and this effect simply
 * never sees an `idle` edge to act on. The `usePermissionsStore` check below
 * is defense-in-depth against a hydration race, not the primary gate.
 *
 * Interrupting (Stop) also drives status to `idle`, but that's the user
 * saying "wait", not "the turn finished" — `stopSession`/`stopSidequest`
 * (`lib/sessionControlActions.ts`) both call
 * `useQueuedMessagesStore.getState().hold(id)` before interrupting, so the
 * `heldSessions` check here keeps the queue parked until a fresh turn starts
 * and clears the latch.
 */
const FLUSH_GRACE_MS = 1500;

export function useQueuedMessageFlusher() {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		if (!window.claude) return;

		// Ids currently being flushed, so a rapid-fire status flap can't send
		// the same head message twice while its delivery is in flight. Shared
		// across both stores — a session id and a sidequest id are drawn from
		// disjoint id spaces (see `isSidequestId`), so one Set is safe.
		const inFlight = new Set<string>();

		const release = (id: string) =>
			useQueuedMessagesStore.getState().release(id);
		const hold = (id: string) => useQueuedMessagesStore.getState().hold(id);

		// Deliver a queued message. Sessions go through `sendTurn`; sidequests
		// go through `sendToSidequest`, which self-heals by re-forking a dead
		// SDK loop — and may hand the turn to a *different* id than the one it
		// was called with. The caller (tryFlush's .catch) needs that landed-in
		// id to restore the message under the right key, so we throw with it
		// attached rather than swallowing the distinction.
		const deliver = async (id: string, msg: QueuedMessage) => {
			if (!isSidequestId(id)) {
				await applyModelForMessage(id, msg.switchModel);
				if (msg.handoffAfter) {
					useQueuedMessagesStore.getState().markHandoff(id);
				}
				try {
					await sendTurn(id, msg.blocks);
				} catch (err) {
					if (msg.handoffAfter) {
						useQueuedMessagesStore.getState().clearHandoff(id);
					}
					throw err;
				}
				return;
			}
			const parentId = useSidequestsStore.getState().parentOf(id);
			if (!parentId) throw new Error("Sidequest no longer exists");
			await applyModelForMessage(id, msg.switchModel);
			const landedIn = await sendToSidequest(parentId, id, msg.blocks);
			if (!landedIn) throw new Error("Couldn't start a sidequest to send to");
		};

		// Resolve the id a failed flush should restore the message under.
		// `sendToSidequest` may have re-forked mid-flight, so the id that
		// started the attempt may no longer be live — fall back to whatever
		// sidequest now lives under the same parent, or the original id if the
		// parent itself vanished (recreateSidequest already migrated the
		// queue in that case, so this is mostly a safety net).
		const recoveryIdFor = (id: string, parentIdAtStart: string | undefined) => {
			if (!isSidequestId(id) || !parentIdAtStart) return id;
			return (
				useSidequestsStore.getState().byParent[parentIdAtStart]?.sidequestId
				?? id
			);
		};

		const tryHandoff = (id: string): boolean => {
			const { pendingHandoff, heldSessions } =
				useQueuedMessagesStore.getState();
			if (!pendingHandoff[id] || heldSessions[id]) return false;
			useQueuedMessagesStore.getState().clearHandoff(id);
			const session = useSessionsStore.getState().sessions[id];
			if (!session) return false;
			const text = handoffReplyText(session);
			if (text === null) return false;
			runHandoff({
				session,
				text,
				navigate: (to) => navigateRef.current(to),
				followIfViewing: true,
			});
			return true;
		};

		const tryFlush = (id: string) => {
			const { heldSessions, queuesBySession } = useQueuedMessagesStore.getState();
			if (heldSessions[id]) return;
			if (inFlight.has(id)) return;
			const pendingPermission = usePermissionsStore
				.getState()
				.queue.some((q) => q.sessionId === id);
			if (pendingPermission) return;
			const queue = queuesBySession[id];
			if (!queue || queue.length === 0) return;

			const msg = useQueuedMessagesStore.getState().shift(id);
			if (!msg) return;
			const parentIdAtStart = isSidequestId(id)
				? useSidequestsStore.getState().parentOf(id)
				: undefined;
			inFlight.add(id);
			deliver(id, msg)
				.catch((err) => {
					// Put it back at the head and latch the queue so we don't
					// immediately retry against a target that just proved it
					// can't accept a turn right now.
					const recoveryId = recoveryIdFor(id, parentIdAtStart);
					useQueuedMessagesStore.getState().unshift(recoveryId, msg);
					useQueuedMessagesStore
						.getState()
						.setError(
							recoveryId,
							err instanceof Error ? err.message : String(err),
						);
					useQueuedMessagesStore.getState().hold(recoveryId);
				})
				.finally(() => {
					inFlight.delete(id);
				});
		};

		const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
		const waitingOnPicker = new Set<string>();

		const cancelPendingFlush = (id: string) => {
			const timer = graceTimers.get(id);
			if (timer !== undefined) clearTimeout(timer);
			graceTimers.delete(id);
			waitingOnPicker.delete(id);
		};

		const isIdle = (id: string): boolean => {
			if (!isSidequestId(id)) {
				return useSessionsStore.getState().sessions[id]?.status === "idle";
			}
			return Object.values(useSidequestsStore.getState().byParent).some(
				(sq) => sq.sidequestId === id && sq.status === "idle",
			);
		};

		const pickerBusyFor = (id: string): boolean => {
			const { openForSessionId, switching } = useModelPickerStore.getState();
			return openForSessionId === id || !!switching[id];
		};

		const flushIfStillIdle = (id: string) => {
			if (!isIdle(id)) return;
			if (pickerBusyFor(id)) {
				waitingOnPicker.add(id);
				return;
			}
			tryFlush(id);
		};

		const scheduleFlush = (id: string) => {
			cancelPendingFlush(id);
			graceTimers.set(
				id,
				setTimeout(() => {
					graceTimers.delete(id);
					flushIfStillIdle(id);
				}, FLUSH_GRACE_MS),
			);
		};

		const unsubscribePicker = useModelPickerStore.subscribe(() => {
			for (const id of [...waitingOnPicker]) {
				if (pickerBusyFor(id)) continue;
				waitingOnPicker.delete(id);
				flushIfStillIdle(id);
			}
		});

		const unsubscribeSessions = useSessionsStore.subscribe((state, prevState) => {
			for (const id of state.order) {
				const prevStatus = prevState.sessions[id]?.status;
				const nextStatus = state.sessions[id]?.status;
				if (prevStatus === nextStatus) continue;
				if (nextStatus === "running") {
					// A new turn started (manual send, resume, or a flushed
					// message) — any interrupt latch from a previous turn no
					// longer applies.
					cancelPendingFlush(id);
					release(id);
				} else if (nextStatus === "usage_limit") {
					cancelPendingFlush(id);
					hold(id);
				} else if (prevStatus === "running" && nextStatus === "idle") {
					if (!tryHandoff(id)) scheduleFlush(id);
				}
			}
			// A session dropped out of the store entirely (deleted) —
			// stop holding a queue for it. Sidequest queues are owned by the
			// sweep below; skip them here so this pass can't race the
			// intermediate tick a re-fork produces (discard-then-register are
			// two separate `useSidequestsStore` updates).
			for (const id of Object.keys(
				useQueuedMessagesStore.getState().queuesBySession,
			)) {
				if (isSidequestId(id)) continue;
				if (!state.sessions[id]) {
					useQueuedMessagesStore.getState().clearSession(id);
				}
			}
			for (const id of Object.keys(
				useQueuedMessagesStore.getState().pendingHandoff,
			)) {
				if (!state.sessions[id]) {
					useQueuedMessagesStore.getState().clearHandoff(id);
				}
			}
		});

		const unsubscribeSidequests = useSidequestsStore.subscribe((state, prevState) => {
			for (const parentId of Object.keys(state.byParent)) {
				const next = state.byParent[parentId];
				const before = prevState.byParent[parentId];
				// A re-fork replaced the entry outright — not a turn edge on the
				// same sidequest. `register` always seeds `status: "starting"`,
				// so this guard also blocks `upsertFromStarted` (which can land
				// `idle` on a just-swapped id) from firing a spurious flush into
				// a brand-new fork. `recreateSidequest` already migrated (or
				// cleared) the old id's queue itself.
				if (!before || before.sidequestId !== next.sidequestId) continue;
				if (before.status === next.status) continue;
				if (next.status === "running") {
					cancelPendingFlush(next.sidequestId);
					release(next.sidequestId);
				} else if (next.status === "usage_limit") {
					cancelPendingFlush(next.sidequestId);
					hold(next.sidequestId);
				} else if (before.status === "running" && next.status === "idle") {
					scheduleFlush(next.sidequestId);
				}
			}
			// Sweep: a parent's sidequest vanished entirely (sidequest:discarded
			// with no re-fork, or the parent session itself was deleted) with no
			// replacement — stop holding a queue for it.
			const live = new Set(
				Object.values(state.byParent).map((sq) => sq.sidequestId),
			);
			for (const id of Object.keys(
				useQueuedMessagesStore.getState().queuesBySession,
			)) {
				if (isSidequestId(id) && !live.has(id)) {
					useQueuedMessagesStore.getState().clearSession(id);
				}
			}
		});

		return () => {
			unsubscribeSessions();
			unsubscribeSidequests();
			unsubscribePicker();
			for (const timer of graceTimers.values()) clearTimeout(timer);
			graceTimers.clear();
			waitingOnPicker.clear();
		};
	}, []);
}
