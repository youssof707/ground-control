import { describe, expect, it } from "vitest";
import { buildReviewPrompt, lineLabel, snippet } from "./reviewPrompt";
import type { ReviewComment } from "./useSourceControlStore";

function comment(over: Partial<ReviewComment>): ReviewComment {
	return {
		id: "c1",
		fileKey: "Wsrc/a.ts",
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		code: "const a = 1;",
		body: "rename",
		...over,
	};
}

describe("buildReviewPrompt", () => {
	it("sorts by path then line and formats ranges", () => {
		const out = buildReviewPrompt([
			comment({ id: "1", path: "src/b.ts", startLine: 4, endLine: 4, code: "b", body: "second file" }),
			comment({ id: "2", startLine: 10, endLine: 12, code: "x\ny\nz", body: " later  " }),
			comment({ id: "3", startLine: 2, endLine: 2, code: "y", body: "earlier" }),
		]);
		expect(out).toBe(
			[
				"Address these review comments on the diff:",
				"",
				"src/a.ts:2\n```\ny\n```\nearlier",
				"",
				"src/a.ts:10-12\n```\nx\ny\nz\n```\nlater",
				"",
				"src/b.ts:4\n```\nb\n```\nsecond file",
			].join("\n"),
		);
	});

	it("uses a longer fence when the code contains one", () => {
		const out = buildReviewPrompt([comment({ code: "```js\nx\n```" })]);
		expect(out).toContain("````\n```js\nx\n```\n````");
	});
});

describe("lineLabel", () => {
	it("labels single lines and ranges", () => {
		expect(lineLabel(3, 3)).toBe("Line 3");
		expect(lineLabel(3, 5)).toBe("Lines 3–5");
	});
});

describe("snippet", () => {
	it("truncates long selections", () => {
		const lines = Array.from({ length: 40 }, (_, i) => `l${i}`);
		const out = snippet(lines).split("\n");
		expect(out).toHaveLength(31);
		expect(out[30]).toBe("…");
	});
});
