import { useInterruptStore } from "../stores/useInterruptStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";

/**
 * Imperative session-control operations, shared by the working chip's stop
 * affordance (via `SessionChat` / `SidequestPanel`) and the global ⌘. handler.
 * Deliberately store-only (no hooks) so it can run from a window keydown
 * listener outside React's render cycle — same pattern as
 * lib/composerActions.ts and lib/sidequestActions.ts.
 */

/**
 * Interrupt a running turn.
 *
 * Callers must go through here rather than `window.claude.interruptSession`
 * directly: interrupting drives status to `idle` too, but that's the user
 * saying "wait", not "the turn finished". Without the `hold()` latch,
 * `useQueuedMessageFlusher` reads that idle edge as a completed turn and
 * fires any queued pre-move — so a bare `interruptSession` call would stop
 * the turn and then immediately start another one.
 *
 * Re-entrancy is guarded through `useInterruptStore` rather than a local
 * flag, so the chip and the hotkey can't both fire a request for the same
 * session.
 */
export async function stopSession(sessionId: string): Promise<void> {
	const { interrupting, begin, end } = useInterruptStore.getState();
	if (interrupting[sessionId]) return;
	begin(sessionId);
	useQueuedMessagesStore.getState().hold(sessionId);
	try {
		await window.claude.interruptSession(sessionId);
	} finally {
		end(sessionId);
	}
}

/**
 * Interrupt a running sidequest. Same shape as `stopSession`, minus the
 * queued-message `hold()`: sidequests have no message queue, so there's no
 * idle-edge flush to suppress.
 *
 * `useInterruptStore` is keyed by plain id string, so an ephemeral sidequest
 * id shares the guard (and the chip's "stopping…" state) with no store row.
 */
export async function stopSidequest(sidequestId: string): Promise<void> {
	const { interrupting, begin, end } = useInterruptStore.getState();
	if (interrupting[sidequestId]) return;
	begin(sidequestId);
	try {
		await window.claude.interruptSession(sidequestId);
	} finally {
		end(sidequestId);
	}
}
