import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editTarget, gitToplevel, lastWorkDirInTranscript, WorkDirTracker } from "./workingCheckout";

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

let sandbox: string;
let repo: string;
let linked: string;

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, env: ENV, stdio: "ignore" });
}

function assistant(cwd: string, name: string, input: unknown): unknown {
	return { type: "assistant", cwd, message: { content: [{ type: "tool_use", name, input }] } };
}

beforeAll(() => {
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-workdir-")));
	repo = path.join(sandbox, "repo");
	fs.mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
	linked = path.join(repo, ".claude", "worktrees", "side");
	git(repo, "worktree", "add", "-q", "-b", "side", linked);
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("editTarget", () => {
	it("returns the folder of an edited file", () => {
		expect(editTarget("Edit", { file_path: "/x/y/z.ts" }, "/a")).toBe("/x/y");
		expect(editTarget("Write", { file_path: "rel/z.ts" }, "/a")).toBe("/a/rel");
		expect(editTarget("MultiEdit", { file_path: "/m/n.ts" }, undefined)).toBe("/m");
		expect(editTarget("NotebookEdit", { notebook_path: "/nb/x.ipynb" }, "/a")).toBe("/nb");
	});

	it("ignores tools that do not edit files", () => {
		expect(editTarget("Read", { file_path: "/x/y.ts" }, "/a")).toBeNull();
		expect(editTarget("Bash", { command: "ls" }, "/a")).toBeNull();
		expect(editTarget("Edit", { file_path: "" }, "/a")).toBeNull();
		expect(editTarget("Edit", null, "/a")).toBeNull();
	});
});

describe("WorkDirTracker", () => {
	it("keeps whichever came last: a cwd change or an edit", () => {
		const tracker = new WorkDirTracker();
		tracker.entry({ type: "user", cwd: "/main" });
		expect(tracker.last).toBe("/main");
		tracker.entry(assistant("/main", "Edit", { file_path: "/wt/src/a.ts" }));
		expect(tracker.last).toBe("/wt/src");
		tracker.entry({ type: "user", cwd: "/main" });
		expect(tracker.last).toBe("/wt/src");
		tracker.entry(assistant("/main", "Read", { file_path: "/other/b.ts" }));
		expect(tracker.last).toBe("/wt/src");
		tracker.entry({ type: "user", cwd: "/elsewhere" });
		expect(tracker.last).toBe("/elsewhere");
	});

	it("reads a transcript file", async () => {
		const file = path.join(sandbox, "t.jsonl");
		fs.writeFileSync(
			file,
			[
				JSON.stringify({ type: "user", cwd: repo }),
				"not json",
				JSON.stringify(assistant(repo, "Write", { file_path: path.join(linked, "new", "f.ts") })),
				"",
			].join("\n"),
		);
		expect(await lastWorkDirInTranscript(file)).toBe(path.join(linked, "new"));
	});
});

describe("gitToplevel", () => {
	it("resolves the worktree a folder belongs to", async () => {
		expect(await gitToplevel(repo)).toBe(repo);
		expect(await gitToplevel(path.join(linked, "does", "not", "exist"))).toBe(linked);
		expect(await gitToplevel(linked)).toBe(linked);
	});

	it("returns null outside a repository", async () => {
		expect(await gitToplevel(sandbox)).toBeNull();
	});
});
