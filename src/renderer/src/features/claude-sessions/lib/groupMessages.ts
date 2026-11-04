import type { SessionMessage } from "@shared/claude-sessions/types";
import {
	isInjectedUserProse,
	isSubagentContent,
	isToolLikeBlockType,
} from "@shared/claude-sessions/transcript";
import { blocksOf, type ContentBlock } from "./messageContent";
import {
	ASK_USER_QUESTION_TOOL,
	answeredQuestionsByToolUseId,
	questionsOf,
	type QuestionAnswers,
	type QuestionDef,
} from "./askUserQuestion";

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
	}
	| {
		kind: "answeredQuestion";
		key: string;
		messageId: string;
		questions: QuestionDef[];
		answers: QuestionAnswers;
	};

// A message qualifies as a "tool turn" if every block is tool-like per the
// shared predicate — tool_use/tool_result (including server-side variants
// like server_tool_use / advisor_tool_result) or thinking. Mixed messages
// with text are rendered normally — once Claude says something to the user,
// the run should break.
function isToolOnlyMessage(m: SessionMessage): boolean {
	if (m.role !== "assistant" && m.role !== "user") return false;
	const blocks = blocksOf(m);
	if (blocks.length === 0) return false;
	return blocks.every((b) => isToolLikeBlockType(b.type));
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
	const answered = answeredQuestionsByToolUseId(messages);
	const carded = new Set<string>();

	const answeredQuestionUnit = (
		messageId: string,
		block: ContentBlock,
	): RenderUnit | null => {
		if (block.type !== "tool_use" || block.name !== ASK_USER_QUESTION_TOOL) {
			return null;
		}
		if (typeof block.id !== "string") return null;
		const answers = answered.get(block.id);
		const questions = questionsOf(block.input);
		if (!answers || questions.length === 0) return null;
		carded.add(block.id);
		return {
			kind: "answeredQuestion",
			key: `question:${block.id}`,
			messageId,
			questions,
			answers,
		};
	};

	const isCardedResult = (block: ContentBlock) =>
		block.type === "tool_result" &&
		typeof block.tool_use_id === "string" &&
		carded.has(block.tool_use_id);

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
			blocksOf(m).forEach((block, blockIndex) => {
				if (isCardedResult(block)) return;
				const card = answeredQuestionUnit(m.id, block);
				if (card) {
					flush();
					units.push(card);
					return;
				}
				if (!run) run = { kind: "toolRun", key: "", entries: [] };
				run.entries.push({ messageId: m.id, blockIndex, block });
				if (!run.key) run.key = `toolrun:${m.id}:${blockIndex}`;
			});
			continue;
		}
		flush();
		units.push({ kind: "message", message: m });
		for (const block of blocksOf(m)) {
			const card = answeredQuestionUnit(m.id, block);
			if (card) units.push(card);
		}
	}
	flush();
	return units;
}
