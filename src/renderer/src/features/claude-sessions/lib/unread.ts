import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { isConversationSkipped } from "@shared/claude-sessions/transcript";

export function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant") continue;
		if (isConversationSkipped(m.role, m.content)) continue;
		return m.ts;
	}
	return 0;
}

export function isSessionUnread(
	session: ClaudeSessionFull,
	lastReadAt: number,
): boolean {
	return (
		session.status !== "running" && lastIncomingMessageTs(session) > lastReadAt
	);
}
