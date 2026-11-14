import { describe, expect, it } from "vitest";
import { parseStatusV2, parseWorktreeList } from "./parseStatus";

const SHA = "1234567890abcdef1234567890abcdef12345678";
const ZERO = "0000000000000000000000000000000000000000";

function records(...parts: string[]): string {
	return parts.map((p) => `${p}\0`).join("");
}

function ordinary(xy: string, path: string): string {
	return `1 ${xy} N... 100644 100644 100644 ${SHA} ${SHA} ${path}`;
}

describe("parseWorktreeList", () => {
	it("reads the main checkout and linked worktrees", () => {
		const out = records(
			"worktree /repo",
			`HEAD ${SHA}`,
			"branch refs/heads/main",
			"",
			"worktree /wt/feature one",
			`HEAD ${SHA}`,
			"branch refs/heads/feat/one",
			"",
		);
		expect(parseWorktreeList(out)).toEqual([
			{ path: "/repo", head: "1234567", branch: "main" },
			{ path: "/wt/feature one", head: "1234567", branch: "feat/one" },
		]);
	});

	it("keeps detached worktrees without a branch", () => {
		const out = records("worktree /wt/d", `HEAD ${SHA}`, "detached", "");
		expect(parseWorktreeList(out)).toEqual([
			{ path: "/wt/d", head: "1234567", branch: null },
		]);
	});

	it("drops bare and prunable entries", () => {
		const out = records(
			"worktree /bare.git",
			"bare",
			"",
			"worktree /repo",
			`HEAD ${SHA}`,
			"branch refs/heads/main",
			"",
			"worktree /gone",
			`HEAD ${SHA}`,
			"branch refs/heads/old",
			"prunable gitdir file points to non-existent location",
			"",
		);
		expect(parseWorktreeList(out).map((e) => e.path)).toEqual(["/repo"]);
	});

	it("returns nothing for empty output", () => {
		expect(parseWorktreeList("")).toEqual([]);
	});
});

describe("parseStatusV2", () => {
	it("reads branch headers", () => {
		const parsed = parseStatusV2(
			records(`# branch.oid ${SHA}`, "# branch.head main"),
		);
		expect(parsed.branch).toBe("main");
		expect(parsed.head).toBe("1234567");
	});

	it("reports a detached head with no branch", () => {
		const parsed = parseStatusV2(
			records(`# branch.oid ${SHA}`, "# branch.head (detached)"),
		);
		expect(parsed.branch).toBeNull();
		expect(parsed.head).toBe("1234567");
	});

	it("reports no head before the first commit", () => {
		const parsed = parseStatusV2(
			records("# branch.oid (initial)", "# branch.head main"),
		);
		expect(parsed.head).toBeNull();
	});

	it("splits staged and unstaged changes", () => {
		const parsed = parseStatusV2(
			records(
				ordinary(".M", "src/unstaged.ts"),
				ordinary("M.", "src/staged.ts"),
				ordinary("MM", "src/both.ts"),
				ordinary("A.", "src/added.ts"),
				ordinary("D.", "src/staged-delete.ts"),
				ordinary(".D", "src/deleted.ts"),
			),
		);
		expect(parsed.staged).toEqual([
			{ path: "src/staged.ts", status: "M" },
			{ path: "src/both.ts", status: "M" },
			{ path: "src/added.ts", status: "A" },
			{ path: "src/staged-delete.ts", status: "D" },
		]);
		expect(parsed.changes).toEqual([
			{ path: "src/unstaged.ts", status: "M" },
			{ path: "src/both.ts", status: "M" },
			{ path: "src/deleted.ts", status: "D" },
		]);
	});

	it("keeps spaces in paths", () => {
		const parsed = parseStatusV2(
			records(ordinary(".M", "docs/my notes file.md"), "? new dir/a b.txt"),
		);
		expect(parsed.changes).toEqual([
			{ path: "docs/my notes file.md", status: "M" },
			{ path: "new dir/a b.txt", status: "U" },
		]);
	});

	it("consumes the original path of a rename", () => {
		const parsed = parseStatusV2(
			records(
				`2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 src/new name.ts`,
				"src/old name.ts",
				ordinary(".M", "src/after.ts"),
			),
		);
		expect(parsed.staged).toEqual([
			{ path: "src/new name.ts", status: "R" },
		]);
		expect(parsed.changes).toEqual([{ path: "src/after.ts", status: "M" }]);
	});

	it("puts conflicts in the merge group", () => {
		const parsed = parseStatusV2(
			records(
				`u UU N... 100644 100644 100644 100644 ${SHA} ${SHA} ${ZERO} src/conflict file.ts`,
			),
		);
		expect(parsed.merge).toEqual([
			{ path: "src/conflict file.ts", status: "C" },
		]);
		expect(parsed.staged).toEqual([]);
		expect(parsed.changes).toEqual([]);
	});

	it("ignores ignored-file records and garbage", () => {
		const parsed = parseStatusV2(records("! ignored.log", "nonsense", "1 M"));
		expect(parsed.staged).toEqual([]);
		expect(parsed.changes).toEqual([]);
		expect(parsed.merge).toEqual([]);
	});
});
