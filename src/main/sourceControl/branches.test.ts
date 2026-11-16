import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBranches, parseRefs, switchArgs, switchBranch, worktreeNameOf } from "./branches";

let sandbox: string;
let origin: string;
let repo: string;
let linked: string;

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: ENV, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function commit(cwd: string, file: string, date: string): void {
	fs.writeFileSync(path.join(cwd, file), file);
	git(cwd, "add", file);
	execFileSync("git", ["commit", "-q", "-m", file], {
		cwd,
		env: { ...ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
	});
}

beforeAll(() => {
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-branches-")));
	origin = path.join(sandbox, "origin");
	fs.mkdirSync(origin);
	git(origin, "init", "-q", "-b", "main");
	commit(origin, "a", "2020-01-01T00:00:00Z");
	git(origin, "switch", "-q", "-c", "remote-only");
	commit(origin, "b", "2022-01-01T00:00:00Z");
	git(origin, "switch", "-q", "main");
	repo = path.join(sandbox, "repo");
	git(sandbox, "clone", "-q", origin, repo);
	git(repo, "switch", "-q", "-c", "recent");
	commit(repo, "c", "2024-01-01T00:00:00Z");
	git(repo, "switch", "-q", "main");
	linked = path.join(sandbox, "side tree");
	git(repo, "worktree", "add", "-q", "-b", "side", linked);
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("branches", () => {
	it("lists local and remote branches newest first, hiding remotes that have a local branch", async () => {
		const list = await listBranches(repo, undefined);
		expect(list.current).toBe("main");
		expect(list.worktreeName).toBeNull();
		const locals = list.branches.filter((b) => !b.remote).map((b) => b.name);
		const remotes = list.branches.filter((b) => b.remote).map((b) => b.name);
		expect(locals[0]).toBe("recent");
		expect(new Set(locals)).toEqual(new Set(["recent", "main", "side"]));
		expect(remotes).toEqual(["origin/remote-only"]);
		expect(list.branches.find((b) => b.name === "side")?.worktree).toBe(linked);
	});

	it("reads the worktree name from git for linked worktrees", async () => {
		const list = await listBranches(linked, undefined);
		expect(list.current).toBe("side");
		expect(list.worktreeName).toBe("side-tree");
	});

	it("switches to local and remote branches and surfaces git errors", async () => {
		await switchBranch(repo, "recent", false);
		expect(git(repo, "branch", "--show-current").trim()).toBe("recent");
		await switchBranch(repo, "origin/remote-only", true);
		expect(git(repo, "branch", "--show-current").trim()).toBe("remote-only");
		await expect(switchBranch(repo, "side", false)).rejects.toThrow(/side/);
		await expect(switchBranch(repo, "nope", false)).rejects.toThrow();
	});

	it("rejects option-like names and parses refs defensively", () => {
		expect(() => switchArgs("--orphan", false)).toThrow();
		expect(worktreeNameOf("/r/.git", "/r/.git")).toBeNull();
		expect(worktreeNameOf("/r/.git/worktrees/x", "/r/.git")).toBe("x");
		const parsed = parseRefs(
			["refs/remotes/origin/HEAD\0refs/remotes/origin/main\0" + "1\0\0", "refs/heads/main\0\0" + "2\0\0*", "garbage"].join("\n"),
		);
		expect(parsed.current).toBe("main");
		expect(parsed.branches.map((b) => b.name)).toEqual(["main"]);
	});
});
