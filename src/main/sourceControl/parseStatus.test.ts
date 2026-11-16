import { describe, expect, it } from "vitest";
import {
	createStatusParser,
	parseWorktreeList,
	type StatusEntry,
} from "./parseStatus";
import { createRecordSplitter } from "./recordStream";

const SHA = "1234567890abcdef1234567890abcdef12345678";
const SHA2 = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const ZERO = "0000000000000000000000000000000000000000";

function records(...parts: string[]): string {
	return parts.map((p) => `${p}\0`).join("");
}

function ordinary(xy: string, path: string, base = SHA): string {
	return `1 ${xy} N... 100644 100644 100644 ${base} ${SHA} ${path}`;
}

function parse(input: string | Buffer) {
	const entries: StatusEntry[] = [];
	const parser = createStatusParser((e) => entries.push(e));
	const splitter = createRecordSplitter(parser.feed);
	splitter.push(typeof input === "string" ? Buffer.from(input, "utf8") : input);
	splitter.end();
	return { entries, header: parser.header };
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
			{ path: "/repo", head: "1234567", branch: "main", isMain: true },
			{ path: "/wt/feature one", head: "1234567", branch: "feat/one", isMain: false },
		]);
	});

	it("keeps detached worktrees without a branch", () => {
		const out = records("worktree /wt/d", `HEAD ${SHA}`, "detached", "");
		expect(parseWorktreeList(out)).toEqual([
			{ path: "/wt/d", head: "1234567", branch: null, isMain: true },
		]);
	});

	it("drops bare and prunable entries and never marks a linked tree as main", () => {
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
		expect(parseWorktreeList(out)).toEqual([
			{ path: "/repo", head: "1234567", branch: "main", isMain: false },
		]);
	});

	it("returns nothing for empty output", () => {
		expect(parseWorktreeList("")).toEqual([]);
	});
});

describe("createStatusParser", () => {
	it("reads branch headers", () => {
		const { header } = parse(records(`# branch.oid ${SHA}`, "# branch.head main"));
		expect(header).toEqual({ branch: "main", head: "1234567", unborn: false });
	});

	it("reports a detached head with no branch", () => {
		const { header } = parse(records(`# branch.oid ${SHA}`, "# branch.head (detached)"));
		expect(header.branch).toBeNull();
		expect(header.head).toBe("1234567");
	});

	it("reports an unborn head", () => {
		const { header } = parse(records("# branch.oid (initial)", "# branch.head main"));
		expect(header).toEqual({ branch: "main", head: null, unborn: true });
	});

	it("splits each path into a staged row and an unstaged row", () => {
		const { entries } = parse(
			records(
				ordinary(".M", "src/unstaged.ts"),
				ordinary("M.", "src/staged.ts"),
				ordinary("MM", "src/both.ts"),
				ordinary("A.", "src/added.ts", ZERO),
				ordinary("D.", "src/staged-delete.ts"),
				ordinary(".D", "src/deleted.ts"),
				ordinary("AM", "src/added-then-edited.ts", ZERO),
			),
		);
		expect(entries.map((e) => [e.path, e.staged, e.status])).toEqual([
			["src/unstaged.ts", false, "M"],
			["src/staged.ts", true, "M"],
			["src/both.ts", true, "M"],
			["src/both.ts", false, "M"],
			["src/added.ts", true, "A"],
			["src/staged-delete.ts", true, "D"],
			["src/deleted.ts", false, "D"],
			["src/added-then-edited.ts", true, "A"],
			["src/added-then-edited.ts", false, "M"],
		]);
		expect(entries[0]).toMatchObject({ baseOid: SHA, targetOid: null });
		expect(entries[1]).toMatchObject({ baseOid: SHA, targetOid: SHA });
		expect(entries[4]).toMatchObject({ baseOid: null, targetOid: SHA });
		expect(entries[5]).toMatchObject({ baseOid: SHA, targetOid: null });
	});

	it("counts one record per path", () => {
		let records_ = 0;
		const parser = createStatusParser(
			() => {},
			() => {
				records_++;
			},
		);
		const splitter = createRecordSplitter(parser.feed);
		splitter.push(Buffer.from(records(ordinary("MM", "a"), ordinary(".M", "b"), "? c"), "utf8"));
		splitter.end();
		expect(records_).toBe(3);
	});

	it("keeps spaces in paths and marks untracked files", () => {
		const { entries } = parse(
			records(ordinary(".M", "docs/my notes file.md"), "? new dir/a b.txt"),
		);
		expect(entries.map((e) => [e.path, e.status, e.baseOid])).toEqual([
			["docs/my notes file.md", "M", SHA],
			["new dir/a b.txt", "U", null],
		]);
	});

	it("consumes the original path of a rename", () => {
		const { entries } = parse(
			records(
				`2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 src/new name.ts`,
				"src/old name.ts",
				ordinary(".M", "src/after.ts"),
			),
		);
		expect(entries.map((e) => [e.path, e.status])).toEqual([
			["src/new name.ts", "R"],
			["src/after.ts", "M"],
		]);
	});

	it("uses our side of a conflict as the original", () => {
		const { entries } = parse(
			records(
				`u UU N... 100644 100644 100644 100644 ${SHA} ${SHA2} ${ZERO} src/conflict file.ts`,
			),
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			path: "src/conflict file.ts",
			status: "C",
			baseOid: SHA2,
		});
	});

	it("flags submodules and symlink modes", () => {
		const { entries } = parse(
			records(
				`1 .M SC.. 160000 160000 160000 ${SHA} ${SHA} vendor/lib`,
				`1 .T N... 100644 100644 120000 ${SHA} ${SHA} link`,
			),
		);
		expect(entries[0].submodule).toBe(true);
		expect(entries[1]).toMatchObject({ status: "M", targetMode: "120000" });
	});

	it("keeps the raw bytes of paths that are not valid UTF-8", () => {
		const raw = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]);
		const input = Buffer.concat([Buffer.from("? "), raw, Buffer.from([0])]);
		const { entries } = parse(input);
		expect(entries).toHaveLength(1);
		expect(entries[0].path).toBe("caf�.txt");
		expect(entries[0].raw?.equals(raw)).toBe(true);
	});

	it("leaves raw empty for valid UTF-8 paths", () => {
		const { entries } = parse(records("? café/日本.txt"));
		expect(entries[0].path).toBe("café/日本.txt");
		expect(entries[0].raw).toBeNull();
	});

	it("ignores ignored-file records and garbage", () => {
		const { entries } = parse(records("! ignored.log", "nonsense", "1 M"));
		expect(entries).toEqual([]);
	});
});
