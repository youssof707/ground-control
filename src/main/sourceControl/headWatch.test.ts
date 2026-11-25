import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitAbortedError } from "./gitProcess";
import { watchHead } from "./headWatch";

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

let base: string;
let repo: string;

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, env: ENV, stdio: "ignore" });
}

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function changesOn(checkout: string, act: () => void): Promise<boolean> {
	const controller = new AbortController();
	let fired = false;
	const watching = watchHead(checkout, controller.signal).then(
		() => {
			fired = true;
		},
		() => undefined,
	);
	await settle(200);
	act();
	for (let i = 0; i < 40 && !fired; i++) await settle(50);
	controller.abort();
	await watching;
	return fired;
}

beforeEach(() => {
	base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-head-")));
	repo = path.join(base, "repo");
	fs.mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "commit", "-q", "--allow-empty", "-m", "init");
	git(repo, "branch", "other");
});

afterEach(() => {
	fs.rmSync(base, { recursive: true, force: true });
});

describe("watchHead", () => {
	it("resolves when the branch is switched outside the app", async () => {
		expect(await changesOn(repo, () => git(repo, "switch", "-q", "other"))).toBe(true);
	});

	it("ignores writes that leave HEAD alone", async () => {
		fs.writeFileSync(path.join(repo, "file.txt"), "x");
		expect(await changesOn(repo, () => git(repo, "add", "file.txt"))).toBe(false);
	});

	it("watches a linked worktree's own HEAD", async () => {
		const linked = path.join(base, "linked");
		git(repo, "worktree", "add", "-q", linked, "other");
		git(repo, "branch", "third");
		expect(await changesOn(linked, () => git(linked, "switch", "-q", "third"))).toBe(true);
	});

	it("rejects as cancelled when aborted", async () => {
		const controller = new AbortController();
		const watching = watchHead(repo, controller.signal);
		await settle(100);
		controller.abort();
		await expect(watching).rejects.toBeInstanceOf(GitAbortedError);
	});
});
