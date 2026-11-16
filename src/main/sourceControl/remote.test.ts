import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteArgs, runRemote } from "./remote";
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

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: ENV, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function commit(cwd: string, name: string): void {
	fs.writeFileSync(path.join(cwd, name), name);
	git(cwd, "add", name);
	git(cwd, "commit", "-m", name);
}

async function header(cwd: string): Promise<ScanOk["header"]> {
	const result = await scanCheckout(cwd, { cap: 100 });
	if (!result.ok) throw new Error(result.reason);
	return result.header;
}

let sandbox: string;
const saved = { ...process.env };

beforeAll(() => {
	Object.assign(process.env, ENV);
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-remote-")));
});

afterAll(() => {
	process.env = saved;
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("runRemote", () => {
	it("tracks ahead/behind and pulls, pushes and publishes", async () => {
		const origin = path.join(sandbox, "origin.git");
		const mine = path.join(sandbox, "mine");
		const theirs = path.join(sandbox, "theirs");
		git(sandbox, "init", "--bare", "-b", "main", origin);
		git(sandbox, "clone", origin, mine);
		git(mine, "switch", "-c", "main");
		commit(mine, "a");
		git(mine, "push", "-u", "origin", "main");
		git(sandbox, "clone", origin, theirs);

		commit(theirs, "b");
		git(theirs, "push");
		commit(mine, "c");

		await runRemote(mine, "fetch", undefined);
		expect(await header(mine)).toMatchObject({ upstream: "origin/main", ahead: 1, behind: 1 });
		await expect(runRemote(mine, "pull", undefined)).rejects.toThrow();

		git(mine, "rebase", "origin/main");
		await runRemote(mine, "push", undefined);
		expect(await header(mine)).toMatchObject({ ahead: 0, behind: 0 });

		await runRemote(theirs, "pull", undefined);
		expect(await header(theirs)).toMatchObject({ ahead: 0, behind: 0 });

		git(mine, "switch", "-c", "feature");
		commit(mine, "d");
		expect((await header(mine)).upstream).toBeNull();
		await runRemote(mine, "push", undefined);
		expect(await header(mine)).toMatchObject({ upstream: "origin/feature", ahead: 0, behind: 0 });
	});
});

describe("remoteArgs", () => {
	it("fetches with prune", () => {
		expect(remoteArgs("fetch", true)).toEqual(["fetch", "--prune", "--no-recurse-submodules"]);
	});

	it("pulls fast-forward only", () => {
		expect(remoteArgs("pull", true)).toEqual(["pull", "--ff-only", "--no-recurse-submodules"]);
	});

	it("pushes to the upstream when there is one", () => {
		expect(remoteArgs("push", true)).toEqual(["push"]);
	});

	it("publishes to origin when there is no upstream", () => {
		expect(remoteArgs("push", false)).toEqual(["push", "-u", "origin", "HEAD"]);
	});
});
