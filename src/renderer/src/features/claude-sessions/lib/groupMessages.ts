import type { SessionMessage } from "@shared/claude-sessions/types";
import {
	isInjectedUserProse,
	isSubagentContent,
	isToolLikeBlockType,
} from "@shared/claude-sessions/transcript";
import { blocksOf, type ContentBlock } from "./messageContent";

// A flat render unit emitted by `groupMessagesIntoUnits`. Either:
//   - a normal message that goes through <MessageView/>, or
//   - a "tool run" — a contiguous sequence of tool_use + tool_result blocks
//     spanning one or more consecutive tool-only messages, rendered as a
//     single collapsible <ToolRunGroup/>.
export type RenderUnit =
	| { kind: "message"; message: SessionMessage }
	| {
		kind: "toolRun";
		// Stable key for React. Uses the first entry's message id + block index
		// so it survives re-renders (messages are append-only).
		key: string;
		entries: { messageId: string; blockIndex: number; block: ContentBlock }[];
	};

// A message qualifies as a "tool turn" if every block is either tool_use
// or thinking/redacted_thinking (assistant), or tool_result (user). Mixed
// messages with text are rendered normally — once Claude says something to
// the user, the run should break.
const ASSISTANT_TOOL_LIKE_TYPES = new Set([
	"tool_use",
	"thinking",
	"redacted_thinking",
]);

function isToolOnlyMessage(m: SessionMessage): boolean {
	if (m.role !== "assistant" && m.role !== "user") return false;
	const blocks = blocksOf(m);
	if (blocks.length === 0) return false;
	if (m.role === "assistant") {
		return blocks.every((b) => ASSISTANT_TOOL_LIKE_TYPES.has(b.type ?? ""));
	}
	// user
	return blocks.every((b) => b.type === "tool_result");
}

// `system` and `result` messages render as `null` in MessageView (see
// MessageView.tsx:56-57). The SDK interleaves them between assistant/user
// turns, so if we let them flush the current tool run we end up with one
// group per message instead of one group per investigation. Skip them
// entirely from grouping decisions — they're invisible to the user and
// should be invisible to the grouper too.
function isInvisibleMessage(m: SessionMessage): boolean {
	return m.role === "system" || m.role === "result";
}

export function groupMessagesIntoUnits(
	messages: SessionMessage[],
): RenderUnit[] {
	const units: RenderUnit[] = [];
	let run: RenderUnit & { kind: "toolRun" } | null = null;

	const flush = () => {
		if (run && run.entries.length > 0) units.push(run);
		run = null;
	};

	for (const m of messages) {
		if (isInvisibleMessage(m)) {
			// Don't flush — these render as nothing and shouldn't fragment runs.
			continue;
		}
		if (isSubagentContent(m.content)) {
			// Subagent traffic: tool-like blocks fold into the current run (the
			// user audits ALL tool access in one merged place, agent-agnostic);
			// prose blocks render nowhere. Handles old persisted prose rows
			// (ingest now drops them, but the store keeps history) and defensive
			// mixed-block messages (text + tool_use in one envelope) without
			// breaking the run. Map before filter so `blockIndex` keeps its
			// original position — ToolRunGroup keys on `${messageId}:${blockIndex}`.
			const toolEntries = blocksOf(m)
				.map((block, blockIndex) => ({ messageId: m.id, blockIndex, block }))
				.filter((e) => isToolLikeBlockType(e.block.type));
			if (toolEntries.length === 0) continue; // pure prose — don't flush
			if (!run) run = { kind: "toolRun", key: "", entries: [] };
			run.entries.push(...toolEntries);
			if (!run.key) run.key = `toolrun:${m.id}:0`;
			continue;
		}
		if (m.role === "user" && isInjectedUserProse(m.content)) {
			// Top-level machine injections (Skill instruction expansions,
			// slash-command expansions, compaction summaries) — hidden, and
			// like other invisible rows they must not fragment a tool run:
			// a Skill tool_use is typically followed immediately by its
			// injected instructions, then more tool calls.
			continue;
		}
		if (isToolOnlyMessage(m)) {
			if (!run) {
				run = { kind: "toolRun", key: "", entries: [] };
			}
			const blocks = blocksOf(m);
			blocks.forEach((block, blockIndex) => {
				run!.entries.push({ messageId: m.id, blockIndex, block });
			});
			if (!run.key) run.key = `toolrun:${m.id}:0`;
			continue;
		}
		flush();
		units.push({ kind: "message", message: m });
	}
	flush();
	return units;
}
