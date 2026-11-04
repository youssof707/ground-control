import type {
	ClaudeSessionFull,
	SessionMessage,
} from "@shared/claude-sessions/types";
import { isSubagentContent } from "@shared/claude-sessions/transcript";
import { blocksOf } from "./messageContent";

export const HANDOFF_COMMAND = "/handoff";

export const HANDOFF_PROMPT = [
	"Give me a handoff for a fresh session: a self-contained brief that a new Claude session with none of this conversation's context can pick up and continue from without asking anything.",
	"",
	"Cover:",
	"- The goal and why it matters.",
	"- Decisions already made (and alternatives rejected, with the reason), so they don't get relitigated.",
	"- Current state: what's done, what's in progress, what's left, with exact file paths, function names, and commands.",
	"- Gotchas, constraints, and project rules discovered along the way.",
	"- How to verify the work.",
	"",
	"Reply with only the handoff itself in markdown, no preamble or sign-off. Don't make any changes in this turn.",
].join("\n");

export function isHandoffCommand(text: string): boolean {
	return text.trim() === HANDOFF_COMMAND;
}

function isHumanTurn(m: SessionMessage): boolean {
	if (m.role !== "user") return false;
	const env = m.content;
	return (
		typeof env === "object" && env !== null && !("parent_tool_use_id" in env)
	);
}

function textOf(m: SessionMessage): string {
	return blocksOf(m)
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => (b.text ?? "").trim())
		.filter((t) => t.length > 0)
		.join("\n\n");
}

export function handoffReplyText(session: ClaudeSessionFull): string | null {
	const replies: string[] = [];
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (isHumanTurn(m)) {
			if (textOf(m) !== HANDOFF_PROMPT) return null;
			const text = replies.reverse().join("\n\n").trim();
			return text || null;
		}
		if (m.role !== "assistant" || isSubagentContent(m.content)) continue;
		const text = textOf(m);
		if (text) replies.push(text);
	}
	return null;
}
