import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bashCandidates, lastBashWriteDir, tokenize } from "./bashWrites";

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
let sibling: string;

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, env: ENV, stdio: "ignore" });
}

function bash(cwd: string, command: string): void {
	execFileSync("/bin/bash", ["-c", command], { cwd, env: ENV, stdio: "ignore" });
}

function past(file: string): void {
	const old = new Date(Date.now() - 60_000);
	fs.utimesSync(file, old, old);
}

beforeAll(() => {
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-bashwrites-")));
	repo = path.join(sandbox, "repo");
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	fs.writeFileSync(path.join(repo, "src", "a.css"), "a\n");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
	sibling = path.join(sandbox, "repo-wt-1");
	git(repo, "worktree", "add", "-q", "-b", "wt-1", sibling);
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

function ageAll(): void {
	for (const dir of [repo, sibling]) {
		for (const rel of ["", "src", "src/a.css"]) past(path.join(dir, rel));
	}
}

describe("tokenize", () => {
	it("splits quoted words and operators", () => {
		expect(tokenize(`cd "a b" && echo 'x y' >> c\\ d`)).toEqual([
			{ word: "cd" },
			{ word: "a b" },
			{ op: "&&" },
			{ word: "echo" },
			{ word: "x y" },
			{ op: ">>" },
			{ word: "c d" },
		]);
	});
});

describe("bashCandidates", () => {
	it("resolves paths against cd targets", () => {
		const found = bashCandidates(`cd ../wt && echo hi >> src/a.css; git -C /x/y commit -m m`, "/base/repo");
		expect(found).toContainEqual({ path: "/base/wt", kind: "repo" });
		expect(found).toContainEqual({ path: "/base/wt/src/a.css", kind: "file" });
		expect(found).toContainEqual({ path: "/x/y", kind: "repo" });
	});
});

describe("lastBashWriteDir", () => {
	it("finds a file appended to in another worktree after cd", async () => {
		ageAll();
		const since = Date.now();
		const command = `cd "${sibling}" && echo "body { color: red; }" >> src/a.css`;
		bash(repo, command);
		expect(await lastBashWriteDir(command, repo, since)).toBe(path.join(sibling, "src"));
	});

	it("finds a new file created by relative path", async () => {
		ageAll();
		const since = Date.now();
		const command = `echo x > ../repo-wt-1/junk.txt`;
		bash(repo, command);
		expect(await lastBashWriteDir(command, repo, since)).toBe(sibling);
	});

	it("finds a commit made with git -C", async () => {
		ageAll();
		const since = Date.now();
		const command = `git -C ../repo-wt-1 commit -q --allow-empty -m e`;
		bash(repo, command);
		expect(await lastBashWriteDir(command, repo, since)).toBe(sibling);
	});

	it("ignores reads", async () => {
		ageAll();
		const since = Date.now();
		const command = `cat ../repo-wt-1/src/a.css && ls ../repo-wt-1/src`;
		bash(repo, command);
		expect(await lastBashWriteDir(command, repo, since)).toBeNull();
	});
});
