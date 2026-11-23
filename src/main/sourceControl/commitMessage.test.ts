import { describe, expect, it } from "vitest";
import { buildCommitPrompt, cleanCommitMessage } from "./commitMessage";

describe("cleanCommitMessage", () => {
	it("strips code fences and trailing whitespace", () => {
		expect(cleanCommitMessage("```\nFix the thing  \n\n\n\nBecause reasons\n```")).toBe(
			"Fix the thing\n\nBecause reasons",
		);
	});

	it("keeps a plain message as is", () => {
		expect(cleanCommitMessage("  Add commit button\n")).toBe("Add commit button");
	});
});

describe("buildCommitPrompt", () => {
	it("includes recent subjects and marks truncated diffs", () => {
		const prompt = buildCommitPrompt({ stat: " a.ts | 2 +-", diff: "diff", truncated: true, recent: ["Fix x"] });
		expect(prompt).toContain("- Fix x");
		expect(prompt).toContain("Staged diff (truncated):");
	});

	it("omits the style section with no history", () => {
		expect(buildCommitPrompt({ stat: "", diff: "", truncated: false, recent: [] })).not.toContain("for style");
	});
});
