import type { SessionMessage } from "@shared/claude-sessions/types";
import { isSubagentContent } from "@shared/claude-sessions/transcript";

/**
 * Can this message serve as a sidequest / fork branch point?
 *
 * Mirrors `MessageView`'s `canFork` check and `groupMessages`' visibility
 * rules: only top-level assistant messages carrying an SDK transcript uuid
 * qualify. Subagent traffic is excluded — it never renders as a top-level
 * turn, and its uuids belong to the subagent's own transcript.
 *
 * The main process re-validates this in `resolveForkSource` (and additionally
 * resolves which SDK session minted the uuid); this is the renderer-side
 * predicate used to *pick* a candidate before making the IPC call.
 */
export function isForkableAssistant(m: SessionMessage): boolean {
	if (m.role !== "assistant") return false;
	if (isSubagentContent(m.content)) return false;
	const uuid = (m.content as { uuid?: unknown }).uuid;
	return typeof uuid === "string" && uuid.length > 0;
}

/**
 * Resolve the fork point for a selection that landed in `containingMessageId`.
 *
 * The selection may land anywhere — an assistant reply, the user's own bubble,
 * or a collapsed tool run. In every case we branch at the nearest forkable
 * assistant message at or before it, so the sidequest starts with the full
 * context the user was looking at (and never *ahead* of it).
 *
 * Returns null when the thread has no forkable message before that point
 * (e.g. the very first user turn, before Claude has replied).
 */
export function resolveForkPointMessageId(
	messages: SessionMessage[],
	containingMessageId: string,
): string | null {
	let idx = messages.findIndex((m) => m.id === containingMessageId);
	// Unknown id (stale DOM, message pruned) — fall back to the end of the
	// thread, which is the same answer the no-selection case gives.
	if (idx < 0) idx = messages.length - 1;
	for (let i = idx; i >= 0; i--) {
		if (isForkableAssistant(messages[i])) return messages[i].id;
	}
	return null;
}

/**
 * The "very last visible Claude message" — the fork point used when Cmd+S is
 * pressed with no selection, and when the panel's Clear button starts fresh.
 */
export function lastForkableMessageId(
	messages: SessionMessage[],
): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isForkableAssistant(messages[i])) return messages[i].id;
	}
	return null;
}
