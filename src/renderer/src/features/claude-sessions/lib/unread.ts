import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { isConversationSkipped } from "@shared/claude-sessions/transcript";
import { blocksOf } from "./messageContent";

export function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant") continue;
		if (isConversationSkipped(m.role, m.content)) continue;
		return m.ts;
	}
	return 0;
}

export function lastIncomingMessageText(session: ClaudeSessionFull): string {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant") continue;
		if (isConversationSkipped(m.role, m.content)) continue;
		const text = blocksOf(m)
			.filter((b) => b.type === "text" && typeof b.text === "string")
			.map((b) => (b.text ?? "").trim())
			.filter((t) => t.length > 0)
			.join("\n\n");
		if (text) return text;
	}
	return "";
}

export function isSessionUnread(
	session: ClaudeSessionFull,
	lastReadAt: number,
): boolean {
	return (
		session.status !== "running" && lastIncomingMessageTs(session) > lastReadAt
	);
}
