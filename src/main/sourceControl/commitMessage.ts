export const COMMIT_DIFF_LIMIT = 60_000;

export interface CommitContext {
	stat: string;
	diff: string;
	truncated: boolean;
	recent: string[];
}

export function buildCommitPrompt(context: CommitContext): string {
	const parts = [
		"Write a git commit message for the staged changes below.",
		"Rules:",
		"- First line: imperative mood, at most 72 characters, no trailing period.",
		"- Add a blank line and a short body only when the change needs explaining. Wrap the body at 72 characters.",
		"- Describe what changed and why, not file-by-file.",
		"- Reply with the commit message only. No preamble, no quotes, no code fences.",
	];
	if (context.recent.length > 0) {
		parts.push("", "Recent commit subjects in this repo, for style:", ...context.recent.map((s) => `- ${s}`));
	}
	parts.push("", "Files changed:", context.stat.trim() || "(none)");
	parts.push("", context.truncated ? "Staged diff (truncated):" : "Staged diff:", context.diff);
	return parts.join("\n");
}

export function cleanCommitMessage(text: string): string {
	let body = text.trim();
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(body);
	if (fenced) body = fenced[1].trim();
	return body
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}
