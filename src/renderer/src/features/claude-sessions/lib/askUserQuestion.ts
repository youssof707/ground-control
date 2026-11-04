import type { SessionMessage } from "@shared/claude-sessions/types";
import { blocksOf, type ContentBlock, type SdkLike } from "./messageContent";

export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

export interface OptionDef {
	label: string;
	description: string;
	preview?: string;
}

export interface QuestionDef {
	question: string;
	header: string;
	options: OptionDef[];
	multiSelect?: boolean;
}

export interface AskUserQuestionInput {
	questions: QuestionDef[];
}

export type QuestionAnswers = Record<string, string>;

export function questionsOf(input: unknown): QuestionDef[] {
	const questions = (input as Partial<AskUserQuestionInput> | undefined)
		?.questions;
	if (!Array.isArray(questions)) return [];
	return questions.filter(
		(q): q is QuestionDef =>
			!!q &&
			typeof q.question === "string" &&
			Array.isArray(q.options),
	);
}

function stringRecord(value: unknown): QuestionAnswers | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out: QuestionAnswers = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v === "string") out[k] = v;
	}
	return Object.keys(out).length > 0 ? out : null;
}

function resultText(block: ContentBlock): string {
	if (typeof block.content === "string") return block.content;
	if (!Array.isArray(block.content)) return "";
	return block.content
		.map((c) =>
			c && typeof c === "object" && typeof c.text === "string" ? c.text : "",
		)
		.join("\n");
}

function answersFromText(text: string): QuestionAnswers | null {
	const out: QuestionAnswers = {};
	for (const match of text.matchAll(/"([^"]+)"="([^"]*)"/g)) {
		out[match[1]] = match[2];
	}
	return Object.keys(out).length > 0 ? out : null;
}

export function answeredQuestionsByToolUseId(
	messages: SessionMessage[],
): Map<string, QuestionAnswers> {
	const askIds = new Set<string>();
	const answered = new Map<string, QuestionAnswers>();
	for (const m of messages) {
		for (const block of blocksOf(m)) {
			if (
				block.type === "tool_use" &&
				block.name === ASK_USER_QUESTION_TOOL &&
				typeof block.id === "string"
			) {
				askIds.add(block.id);
				continue;
			}
			if (
				block.type !== "tool_result" ||
				block.is_error === true ||
				typeof block.tool_use_id !== "string" ||
				!askIds.has(block.tool_use_id)
			) {
				continue;
			}
			const structured = (m.content as SdkLike | undefined)?.tool_use_result;
			const answers =
				stringRecord((structured as { answers?: unknown } | undefined)?.answers) ??
				answersFromText(resultText(block));
			if (answers) answered.set(block.tool_use_id, answers);
		}
	}
	return answered;
}
