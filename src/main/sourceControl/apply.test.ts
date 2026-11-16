import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScmAction, ScmPick } from "../../shared/schemas/source_control";
import { applyAction } from "./apply";
import type { StatusEntry } from "./parseStatus";
import { scanCheckout, type ScanOk } from "./scan";

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

let repo: string;

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: repo, env: ENV, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function write(file: string, content: string): void {
	const full = path.join(repo, file);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
}

function read(file: string): string | null {
	const full = path.join(repo, file);
	return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

async function scan(): Promise<ScanOk> {
	const result = await scanCheckout(repo, { cap: 50_000 });
	if (!result.ok) throw new Error(result.reason);
	return result;
}

function rows(result: ScanOk): string[] {
	return result.entries.map((e) => `${e.staged ? "S" : "W"} ${e.status} ${e.path}`);
}

async function run(action: ScmAction, staged: ScmPick, unstaged: ScmPick): Promise<ScanOk> {
	const before = await scan();
	const pick = (p: ScmPick, isStaged: boolean): StatusEntry[] | "all" =>
		p === "all"
			? "all"
			: before.entries.filter((e) => e.staged === isStaged && p.includes(e.path));
	await applyAction(action, {
		root: before.root,
		unborn: before.header.unborn,
		staged: pick(staged, true),
		unstaged: pick(unstaged, false),
		allEntries: before.entries,
	});
	return scan();
}

beforeEach(() => {
	repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-apply-")));
	git("init", "-q", "-b", "main");
	write("a.txt", "a\n");
	write("b.txt", "b\n");
	write("dir/c.txt", "c\n");
	git("add", ".");
	git("commit", "-q", "-m", "init");
});

afterEach(() => {
	fs.rmSync(repo, { recursive: true, force: true });
});

describe("applyAction", () => {
	it("lists staged rows before unstaged rows", async () => {
		write("a.txt", "a2\n");
		write("b.txt", "b2\n");
		git("add", "b.txt");
		write("new.txt", "n\n");
		const result = await scan();
		expect(rows(result)).toEqual(["S M b.txt", "W M a.txt", "W U new.txt"]);
		expect(result.stagedListed).toBe(1);
		expect(result.changed).toBe(3);
	});

	it("stages and unstages chosen paths", async () => {
		write("a.txt", "a2\n");
		write("new.txt", "n\n");
		fs.rmSync(path.join(repo, "b.txt"));
		let result = await run("stage", [], ["a.txt", "new.txt", "b.txt"]);
		expect(rows(result)).toEqual(["S M a.txt", "S D b.txt", "S A new.txt"]);
		result = await run("unstage", ["new.txt", "b.txt"], []);
		expect(rows(result)).toEqual(["S M a.txt", "W D b.txt", "W U new.txt"]);
	});

	it("stages and unstages everything", async () => {
		write("a.txt", "a2\n");
		write("new.txt", "n\n");
		let result = await run("stage", [], "all");
		expect(rows(result)).toEqual(["S M a.txt", "S A new.txt"]);
		result = await run("unstage", "all", []);
		expect(rows(result)).toEqual(["W M a.txt", "W U new.txt"]);
	});

	it("discards chosen unstaged changes, deleting untracked files", async () => {
		write("a.txt", "a2\n");
		git("add", "a.txt");
		write("a.txt", "a3\n");
		write("b.txt", "b2\n");
		write("new.txt", "n\n");
		const result = await run("discard", [], ["a.txt", "new.txt"]);
		expect(read("a.txt")).toBe("a2\n");
		expect(read("new.txt")).toBeNull();
		expect(rows(result)).toEqual(["S M a.txt", "W M b.txt"]);
	});

	it("discards staged rows back to HEAD, removing added files", async () => {
		write("a.txt", "a2\n");
		write("added.txt", "x\n");
		git("add", ".");
		write("a.txt", "a3\n");
		const result = await run("discard", ["a.txt", "added.txt"], []);
		expect(read("a.txt")).toBe("a\n");
		expect(read("added.txt")).toBeNull();
		expect(rows(result)).toEqual([]);
	});

	it("discards everything", async () => {
		write("a.txt", "a2\n");
		git("add", "a.txt");
		write("dir/c.txt", "c2\n");
		fs.rmSync(path.join(repo, "b.txt"));
		write("deep/new/file.txt", "n\n");
		const result = await run("discard", "all", "all");
		expect(rows(result)).toEqual([]);
		expect(read("a.txt")).toBe("a\n");
		expect(read("b.txt")).toBe("b\n");
		expect(fs.existsSync(path.join(repo, "deep"))).toBe(false);
	});

	it("discards every unstaged change but keeps staged ones", async () => {
		write("a.txt", "a2\n");
		git("add", "a.txt");
		write("b.txt", "b2\n");
		write("new.txt", "n\n");
		const result = await run("discard", [], "all");
		expect(rows(result)).toEqual(["S M a.txt"]);
		expect(read("b.txt")).toBe("b\n");
	});

	it("treats paths with glob characters literally", async () => {
		write("[a].txt", "x\n");
		write("a.txt", "a2\n");
		const result = await run("stage", [], ["[a].txt"]);
		expect(rows(result)).toEqual(["S A [a].txt", "W M a.txt"]);
	});

	it("works in a repository with no commits", async () => {
		fs.rmSync(path.join(repo, ".git"), { recursive: true });
		git("init", "-q", "-b", "main");
		git("add", "a.txt");
		let result = await run("unstage", ["a.txt"], []);
		expect(rows(result)).toEqual(["W U a.txt", "W U b.txt", "W U dir/c.txt"]);
		git("add", ".");
		result = await run("discard", ["b.txt"], []);
		expect(read("b.txt")).toBeNull();
		expect(rows(result)).toEqual(["S A a.txt", "S A dir/c.txt"]);
	});
});
