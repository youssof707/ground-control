import type { UserContentBlock } from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";

/**
 * Deliver a turn to an already-real (non-draft) session. Extracted from
 * `ImagePasteTextarea.send()` so the composer's own Send button and the
 * queued-message flusher (`useQueuedMessageFlusher`) share one code path
 * instead of the flusher re-deriving "is this session open" logic.
 *
 * Draft → real-session promotion is NOT handled here — a draft session is
 * never `running`, so it can never have a queued message to flush, and the
 * composer's own `send()` keeps owning that branch.
 */
export async function sendTurn(
	sessionId: string,
	blocks: UserContentBlock[],
): Promise<void> {
	const sess = useSessionsStore.getState().sessions[sessionId];
	const isOpen =
		sess?.status === "running"
		|| sess?.status === "idle"
		|| sess?.status === "awaiting_permission";
	// A session that finished (done/errored/cancelled) but still has an SDK
	// session id can be resumed in place — mirrors the pre-send check in
	// ImagePasteTextarea.send().
	if (!isOpen && sess?.sdkSessionId) {
		await window.claude.resumeSession(sessionId);
	}
	await window.claude.sendUserMessage({ sessionId, blocks });
	// Optimistic local echo — the SDK never echoes user turns back.
	useSessionsStore.getState().appendMessage(sessionId, {
		id: crypto.randomUUID(),
		role: "user",
		content: {
			type: "user",
			message: { role: "user", content: blocks },
		},
		ts: Date.now(),
	});
}
