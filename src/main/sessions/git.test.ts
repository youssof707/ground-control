import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCurrentBranch } from "./git";

let sandbox: string;

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, env: ENV, stdio: "ignore" });
}

function makeRepo(name: string, commit: boolean): string {
	const dir = path.join(sandbox, name);
	fs.mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	if (commit) git(dir, "commit", "-q", "--allow-empty", "-m", "init");
	return dir;
}

beforeAll(() => {
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-git-branch-")));
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("getCurrentBranch", () => {
	it("returns the branch name", async () => {
		const repo = makeRepo("plain", true);
		git(repo, "switch", "-q", "-c", "feature");
		expect(await getCurrentBranch(repo)).toBe("feature");
	});

	it("ignores a tag with the same name as the branch", async () => {
		const repo = makeRepo("tagged", true);
		git(repo, "tag", "main");
		expect(await getCurrentBranch(repo)).toBe("main");
	});

	it("returns the branch of a repository with no commits", async () => {
		expect(await getCurrentBranch(makeRepo("unborn", false))).toBe("main");
	});

	it("returns HEAD when detached", async () => {
		const repo = makeRepo("detached", true);
		git(repo, "checkout", "-q", "--detach");
		expect(await getCurrentBranch(repo)).toBe("HEAD");
	});

	it("returns undefined outside a repository", async () => {
		const dir = path.join(sandbox, "not-a-repo");
		fs.mkdirSync(dir);
		expect(await getCurrentBranch(dir)).toBeUndefined();
	});
});
