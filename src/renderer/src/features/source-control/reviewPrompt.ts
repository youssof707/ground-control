import type { ReviewComment } from "./useSourceControlStore";

const MAX_CODE_LINES = 30;

export function lineLabel(startLine: number, endLine: number): string {
	return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
}

export function snippet(lines: string[]): string {
	if (lines.length <= MAX_CODE_LINES) return lines.join("\n");
	return [...lines.slice(0, MAX_CODE_LINES), "…"].join("\n");
}

function fenceFor(code: string): string {
	let fence = "```";
	while (code.includes(fence)) fence += "`";
	return fence;
}

export function buildReviewPrompt(comments: readonly ReviewComment[]): string {
	const sorted = [...comments].sort((a, b) =>
		a.path === b.path ? a.startLine - b.startLine : a.path < b.path ? -1 : 1,
	);
	const parts = sorted.map((c) => {
		const lines = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
		const fence = fenceFor(c.code);
		return `${c.path}:${lines}\n${fence}\n${c.code}\n${fence}\n${c.body.trim()}`;
	});
	return `Address these review comments on the diff:\n\n${parts.join("\n\n")}`;
}
