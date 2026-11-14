import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSnapshot } from "./service";

let sandbox: string;
let repo: string;
let linked: string;
let plain: string;

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, {
		cwd,
		stdio: "ignore",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
		},
	});
}

beforeAll(() => {
	sandbox = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-test-")),
	);
	repo = path.join(sandbox, "repo");
	linked = path.join(sandbox, "linked tree");
	plain = path.join(sandbox, "plain");
	fs.mkdirSync(repo);
	fs.mkdirSync(plain);

	git(repo, "init", "-b", "main");
	fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
	fs.writeFileSync(path.join(repo, "staged.txt"), "one\n");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "init");
	git(repo, "worktree", "add", "-b", "feature", linked);

	fs.writeFileSync(path.join(repo, "tracked.txt"), "two\n");
	fs.writeFileSync(path.join(repo, "staged.txt"), "two\n");
	git(repo, "add", "staged.txt");
	fs.mkdirSync(path.join(repo, "new dir"));
	fs.writeFileSync(path.join(repo, "new dir", "fresh file.txt"), "x\n");

	fs.writeFileSync(path.join(linked, "only-here.txt"), "x\n");
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("getSnapshot", () => {
	it("reports the root checkout and every worktree", async () => {
		const snapshot = await getSnapshot(repo);
		if (!snapshot.ok) throw new Error(`expected ok, got ${snapshot.reason}`);

		expect(snapshot.checkouts.map((c) => c.path)).toEqual([repo, linked]);

		const [root, wt] = snapshot.checkouts;
		expect(root.isMain).toBe(true);
		expect(root.ok).toBe(true);
		expect(root.branch).toBe("main");
		expect(root.staged.files).toEqual([{ path: "staged.txt", status: "M" }]);
		expect(root.changes.files).toEqual([
			{ path: "tracked.txt", status: "M" },
			{ path: "new dir/fresh file.txt", status: "U" },
		]);
		expect(root.merge.total).toBe(0);

		expect(wt.isMain).toBe(false);
		expect(wt.branch).toBe("feature");
		expect(wt.staged.total).toBe(0);
		expect(wt.changes.files).toEqual([
			{ path: "only-here.txt", status: "U" },
		]);
	});

	it("lists every worktree when asked from a linked worktree", async () => {
		const snapshot = await getSnapshot(linked);
		if (!snapshot.ok) throw new Error(`expected ok, got ${snapshot.reason}`);
		expect(snapshot.checkouts.map((c) => c.path)).toEqual([repo, linked]);
	});

	it("does not take the index lock", async () => {
		await getSnapshot(repo);
		expect(fs.existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);
	});

	it("shares one request between concurrent callers", () => {
		expect(getSnapshot(repo)).toBe(getSnapshot(repo));
	});

	it("reports a folder that is not a repository", async () => {
		expect(await getSnapshot(plain)).toEqual({
			ok: false,
			reason: "not-a-repo",
		});
	});

	it("reports a missing folder without throwing", async () => {
		expect(await getSnapshot(path.join(sandbox, "missing"))).toEqual({
			ok: false,
			reason: "failed",
		});
	});
});
