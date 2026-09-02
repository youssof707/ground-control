import { AUTO_RESUME_TEXT } from "@shared/claude-sessions/transcript";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { sendTurn } from "./sendTurn";

/**
 * "Switch model + resume" in one gesture, wired from `ModelPickerModal`'s
 * `onSwitchAndResume` (SessionTokenBar) whenever a model is picked while the
 * session is running/awaiting-permission. Collapses the routine this
 * feature exists to shortcut — interrupt, switch, type "continue", send —
 * into a single call: interrupt the current turn, set the new model, then
 * resume immediately instead of making the user type anything.
 *
 * If a message is already queued for this session (the composer's "Queue
 * message" pre-move), that's unambiguously what the user meant to say next
 * — flush it as the resume turn, as real content, rendered as a normal
 * bubble. Otherwise send the fixed `AUTO_RESUME_TEXT` marker, which
 * MessageView renders as a dim system note instead of a chat bubble (see
 * `autoResumeMarkerText` in transcript.ts) — switching models shouldn't
 * litter the transcript with throwaway "continue" messages.
 *
 * Reuses the same `hold()` guard `SessionChat.stop()` uses for a manual
 * interrupt, so `useQueuedMessageFlusher` can't race this function's own
 * explicit flush of the queue on the interrupt-driven idle transition. A
 * successful `sendTurn` below drives the session back to `running`, which
 * the flusher's own status-change listener already treats as "release the
 * hold" (see useQueuedMessageFlusher.ts) — the `finally` here is just the
 * fallback for the failure paths where that transition never happens.
 */
export async function switchModelAndResume(
	sessionId: string,
	model: string | undefined,
): Promise<void> {
	useQueuedMessagesStore.getState().hold(sessionId);
	try {
		await window.claude.interruptSession(sessionId);
		await window.claude.setSessionModel(sessionId, model);

		const queued = useQueuedMessagesStore.getState().shift(sessionId);
		try {
			await sendTurn(
				sessionId,
				queued ? queued.blocks : [{ type: "text", text: AUTO_RESUME_TEXT }],
			);
		} catch (err) {
			// Don't lose a real, user-typed queued message — put it back at
			// the head, same recovery useQueuedMessageFlusher does on a
			// failed flush.
			if (queued) useQueuedMessagesStore.getState().unshift(sessionId, queued);
			useQueuedMessagesStore
				.getState()
				.setError(sessionId, err instanceof Error ? err.message : String(err));
			throw err;
		}
	} finally {
		useQueuedMessagesStore.getState().release(sessionId);
	}
}
