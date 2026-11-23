import { describe, expect, it } from "vitest";
import { formatFileRef, parseFileRef } from "./fileRef";

describe("parseFileRef", () => {
	it("accepts relative and absolute paths", () => {
		expect(parseFileRef("src/main/index.ts")).toEqual({ path: "src/main/index.ts" });
		expect(parseFileRef("/Users/me/notes.md")).toEqual({ path: "/Users/me/notes.md" });
		expect(parseFileRef("~/x/config")).toEqual({ path: "~/x/config" });
		expect(parseFileRef("./run.sh")).toEqual({ path: "./run.sh" });
		expect(parseFileRef("../a/b")).toEqual({ path: "../a/b" });
		expect(parseFileRef("/Users/me/folder/")).toEqual({ path: "/Users/me/folder/" });
	});

	it("reads line suffixes", () => {
		expect(parseFileRef("src/a.ts:42")).toEqual({ path: "src/a.ts", line: 42 });
		expect(parseFileRef("src/a.ts:42:7")).toEqual({ path: "src/a.ts", line: 42 });
		expect(parseFileRef("src/a.ts:10-20")).toEqual({ path: "src/a.ts", line: 10, endLine: 20 });
		expect(parseFileRef("src/a.ts#L5")).toEqual({ path: "src/a.ts", line: 5 });
		expect(parseFileRef("src/a.ts#L5-L9")).toEqual({ path: "src/a.ts", line: 5, endLine: 9 });
		expect(parseFileRef("src/a.ts:20-10")).toEqual({ path: "src/a.ts", line: 20 });
	});

	it("accepts bare file names only with a line", () => {
		expect(parseFileRef("MarkdownText.tsx:12")).toEqual({ path: "MarkdownText.tsx", line: 12 });
		expect(parseFileRef("package.json")).toBeNull();
		expect(parseFileRef("process.env")).toBeNull();
		expect(parseFileRef("localhost:3000")).toBeNull();
	});

	it("rejects URLs and non-paths", () => {
		expect(parseFileRef("https://example.com/a.ts")).toBeNull();
		expect(parseFileRef("mailto:me@example.com")).toBeNull();
		expect(parseFileRef("//cdn.example.com/a.js")).toBeNull();
		expect(parseFileRef("and/or")).toBeNull();
		expect(parseFileRef("a / b")).toBeNull();
		expect(parseFileRef("npm run build")).toBeNull();
		expect(parseFileRef("x = a/b.ts")).toBeNull();
		expect(parseFileRef("/")).toBeNull();
		expect(parseFileRef("")).toBeNull();
	});

	it("decodes file URLs", () => {
		expect(parseFileRef("file:///Users/me/My%20Files/a.ts#L3", { allowSpaces: true })).toEqual({
			path: "/Users/me/My Files/a.ts",
			line: 3,
		});
		expect(parseFileRef("file://remote/a.ts")).toBeNull();
	});

	it("allows spaces only when asked", () => {
		expect(parseFileRef("/Users/me/Working Files/a.ts")).toBeNull();
		expect(parseFileRef("/Users/me/Working Files/a.ts", { allowSpaces: true })).toEqual({
			path: "/Users/me/Working Files/a.ts",
		});
	});
});

describe("formatFileRef", () => {
	it("prints lines and ranges", () => {
		expect(formatFileRef({ path: "a/b.ts" })).toBe("a/b.ts");
		expect(formatFileRef({ path: "a/b.ts", line: 3 })).toBe("a/b.ts:3");
		expect(formatFileRef({ path: "a/b.ts", line: 3, endLine: 8 })).toBe("a/b.ts:3-8");
	});
});
