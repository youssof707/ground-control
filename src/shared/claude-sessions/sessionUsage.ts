import type { SessionMessage, SessionUsage } from "../schemas/claude_session";

interface ModelUsageTotals {
	inputTokens?: unknown;
	outputTokens?: unknown;
	cacheReadInputTokens?: unknown;
	cacheCreationInputTokens?: unknown;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export const EMPTY_USAGE: SessionUsage = { input: 0, output: 0 };

export const usageTotal = (u: SessionUsage): number => u.input + u.output;

export const addUsage = (a: SessionUsage, b: SessionUsage): SessionUsage => ({
	input: a.input + b.input,
	output: a.output + b.output,
});

export const subtractUsage = (
	a: SessionUsage,
	b: SessionUsage,
): SessionUsage => ({
	input: a.input - b.input,
	output: a.output - b.output,
});

export function sumModelUsage(modelUsage: unknown): SessionUsage | null {
	if (!modelUsage || typeof modelUsage !== "object") return null;
	let input = 0;
	let output = 0;
	for (const u of Object.values(modelUsage as Record<string, ModelUsageTotals>)) {
		if (!u || typeof u !== "object") continue;
		input +=
			num(u.inputTokens) +
			num(u.cacheReadInputTokens) +
			num(u.cacheCreationInputTokens);
		output += num(u.outputTokens);
	}
	return { input, output };
}

export function estimateUsageFromTranscript(
	messages: SessionMessage[],
): SessionUsage {
	let finishedProcesses = EMPTY_USAGE;
	let currentProcess = EMPTY_USAGE;
	for (const m of messages) {
		if (m.role !== "result") continue;
		const cumulative = sumModelUsage(
			(m.content as { modelUsage?: unknown } | null)?.modelUsage,
		);
		if (cumulative == null) continue;
		if (usageTotal(cumulative) < usageTotal(currentProcess)) {
			finishedProcesses = addUsage(finishedProcesses, currentProcess);
		}
		currentProcess = cumulative;
	}
	return addUsage(finishedProcesses, currentProcess);
}
