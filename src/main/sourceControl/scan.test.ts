import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HARD_LIMIT, SOFT_LIMIT, readDiff } from "./content";
import { setGitBinary } from "./gitProcess";
import { scanCheckout, type ScanOk } from "./scan";

let sandbox: string;
let repo: string;
let linked: string;
let plain: string;

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

const RAW_NAME = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74]);

function rawNamesSupported(): boolean {
	const probe = Buffer.concat([Buffer.from(path.join(os.tmpdir(), "gc-scm-probe-")), RAW_NAME]);
	try {
		fs.writeFileSync(probe, "");
		fs.rmSync(probe);
		return true;
	} catch {
		return false;
	}
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: ENV, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function write(file: string, content: string | Buffer): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function makeRepo(name: string): string {
	const dir = path.join(sandbox, name);
	fs.mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	return dir;
}

async function scanOk(checkout: string, cap = 50_000): Promise<ScanOk> {
	const result = await scanCheckout(checkout, { cap });
	if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
	return result;
}

function entry(result: ScanOk, file: string) {
	const found = result.entries.find((e) => e.path === file);
	if (!found) throw new Error(`no entry for ${file}`);
	return found;
}

beforeAll(() => {
	sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-scan-")));
	repo = makeRepo("repo");
	linked = path.join(sandbox, "linked tree");
	plain = path.join(sandbox, "plain");
	fs.mkdirSync(plain);

	write(path.join(repo, "tracked.txt"), "one\n");
	write(path.join(repo, "staged.txt"), "one\n");
	write(path.join(repo, "gone.txt"), "bye\n");
	write(path.join(repo, "crlf.txt"), "a\nb\n");
	write(path.join(repo, "bin.dat"), Buffer.from([1, 0, 2, 0]));
	fs.symlinkSync("tracked.txt", path.join(repo, "link"));
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
	git(repo, "worktree", "add", "-q", "-b", "feature", linked);

	write(path.join(repo, "tracked.txt"), "two\n");
	write(path.join(repo, "staged.txt"), "two\n");
	git(repo, "add", "staged.txt");
	fs.rmSync(path.join(repo, "gone.txt"));
	write(path.join(repo, "crlf.txt"), "a\r\nb\r\n");
	write(path.join(repo, "bin.dat"), Buffer.from([1, 0, 3, 0]));
	fs.rmSync(path.join(repo, "link"));
	fs.symlinkSync("staged.txt", path.join(repo, "link"));
	write(path.join(repo, "new dir", "fresh file.txt"), "x\n");
	write(path.join(linked, "only-here.txt"), "x\n");
});

afterEach(() => {
	setGitBinary("git");
});

afterAll(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("scanCheckout", () => {
	it("lists every changed path with worktrees and branch", async () => {
		const result = await scanOk(repo);
		expect(result.header.branch).toBe("main");
		expect(result.header.unborn).toBe(false);
		expect(result.worktreeName).toBeNull();
		expect(result.worktrees.map((w) => [w.path, w.isMain, w.branch])).toEqual([
			[repo, true, "main"],
			[linked, false, "feature"],
		]);
		const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e.status]));
		expect(byPath).toMatchObject({
			"tracked.txt": "M",
			"staged.txt": "M",
			"gone.txt": "D",
			"crlf.txt": "M",
			"bin.dat": "M",
			link: "M",
			"new dir/fresh file.txt": "U",
		});
		expect(result.changed).toBe(result.entries.length);
		expect(result.conflicts).toBe(0);
	});

	it("scans a linked worktree on its own", async () => {
		const result = await scanOk(linked);
		expect(result.header.branch).toBe("feature");
		expect(result.worktreeName).toBe("linked-tree");
		expect(result.entries.map((e) => e.path)).toEqual(["only-here.txt"]);
		expect(result.worktrees).toHaveLength(2);
	});

	it("leaves out linked worktrees nested inside the checkout", async () => {
		const outer = makeRepo("nesting");
		write(path.join(outer, "a.txt"), "a\n");
		git(outer, "add", ".");
		git(outer, "commit", "-q", "-m", "init");
		git(outer, "worktree", "add", "-q", "-b", "inner", path.join(outer, ".claude", "worktrees", "inner"));
		write(path.join(outer, ".claude", "worktrees", "inner", "inner-only.txt"), "x\n");
		write(path.join(outer, "outer-only.txt"), "y\n");
		const main = await scanOk(outer);
		expect(main.entries.map((e) => e.path)).toEqual(["outer-only.txt"]);
		expect(main.unstaged).toBe(1);
		expect(main.changed).toBe(1);
		const inner = await scanOk(path.join(outer, ".claude", "worktrees", "inner"));
		expect(inner.worktreeName).toBe("inner");
		expect(inner.entries.map((e) => e.path)).toEqual(["inner-only.txt"]);
	});

	it("does not take the index lock", async () => {
		await scanOk(repo);
		expect(fs.existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);
	});

	it("counts past the cap but keeps only the capped list", async () => {
		const result = await scanOk(repo, 2);
		expect(result.entries).toHaveLength(2);
		expect(result.changed).toBeGreaterThan(2);
	});

	it("reports a folder that is not a repository", async () => {
		expect(await scanCheckout(plain, { cap: 10 })).toEqual({ ok: false, reason: "not-a-repo" });
	});

	it("reports a missing folder", async () => {
		expect(await scanCheckout(path.join(sandbox, "missing"), { cap: 10 })).toEqual({
			ok: false,
			reason: "missing-cwd",
		});
	});

	it("reports a missing git binary", async () => {
		setGitBinary(path.join(sandbox, "no-such-git"));
		expect(await scanCheckout(repo, { cap: 10 })).toEqual({ ok: false, reason: "git-missing" });
	});

	it("handles a repository with no commits", async () => {
		const fresh = makeRepo("fresh");
		write(path.join(fresh, "a.txt"), "a\n");
		const result = await scanOk(fresh);
		expect(result.header).toEqual({ branch: "main", head: null, unborn: true });
		expect(result.entries.map((e) => [e.path, e.status])).toEqual([["a.txt", "U"]]);
	});

	it("handles a detached head", async () => {
		const detached = makeRepo("detached");
		write(path.join(detached, "a.txt"), "a\n");
		git(detached, "add", ".");
		git(detached, "commit", "-q", "-m", "a");
		git(detached, "checkout", "-q", "--detach");
		const result = await scanOk(detached);
		expect(result.header.branch).toBeNull();
		expect(result.header.head).toMatch(/^[0-9a-f]{7}$/);
	});

	it("reports merge conflicts", async () => {
		const merge = makeRepo("merge");
		write(path.join(merge, "c.txt"), "base\n");
		git(merge, "add", ".");
		git(merge, "commit", "-q", "-m", "base");
		git(merge, "checkout", "-q", "-b", "other");
		write(path.join(merge, "c.txt"), "theirs\n");
		git(merge, "commit", "-q", "-am", "theirs");
		git(merge, "checkout", "-q", "main");
		write(path.join(merge, "c.txt"), "ours\n");
		git(merge, "commit", "-q", "-am", "ours");
		try {
			git(merge, "merge", "-q", "other");
		} catch {
			undefined;
		}
		const result = await scanOk(merge);
		expect(result.conflicts).toBe(1);
		const conflict = entry(result, "c.txt");
		expect(conflict.status).toBe("C");
		const diff = await readDiff(merge, conflict, { signal: new AbortController().signal, force: false });
		expect(diff).toMatchObject({ kind: "text", original: "ours\n" });
		if (diff.kind === "text") expect(diff.modified).toContain("<<<<<<<");
	});

	it("stops a slow git promptly when cancelled", async () => {
		const fake = path.join(sandbox, "slow-git");
		fs.writeFileSync(fake, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
		setGitBinary(fake);
		const controller = new AbortController();
		const pending = scanCheckout(repo, { cap: 10, signal: controller.signal });
		await new Promise((r) => setTimeout(r, 100));
		const started = Date.now();
		controller.abort();
		expect(await pending).toEqual({ ok: false, reason: "cancelled" });
		expect(Date.now() - started).toBeLessThan(500);
		expect(() => execFileSync("pgrep", ["-f", fake])).toThrow();
	});
});

describe("readDiff", () => {
	const signal = (): AbortSignal => new AbortController().signal;

	it("diffs a modified file against HEAD, staged or not", async () => {
		const result = await scanOk(repo);
		expect(await readDiff(repo, entry(result, "tracked.txt"), { signal: signal(), force: false })).toEqual({
			kind: "text",
			original: "one\n",
			modified: "two\n",
			lossy: false,
		});
		expect(await readDiff(repo, entry(result, "staged.txt"), { signal: signal(), force: false })).toMatchObject({
			original: "one\n",
			modified: "two\n",
		});
	});

	it("shows deleted and untracked files against an empty side", async () => {
		const result = await scanOk(repo);
		expect(await readDiff(repo, entry(result, "gone.txt"), { signal: signal(), force: false })).toMatchObject({
			kind: "text",
			original: "bye\n",
			modified: "",
		});
		expect(
			await readDiff(repo, entry(result, "new dir/fresh file.txt"), { signal: signal(), force: false }),
		).toMatchObject({ kind: "text", original: "", modified: "x\n" });
	});

	it("keeps CRLF content as-is", async () => {
		const result = await scanOk(repo);
		expect(await readDiff(repo, entry(result, "crlf.txt"), { signal: signal(), force: false })).toMatchObject({
			original: "a\nb\n",
			modified: "a\r\nb\r\n",
		});
	});

	it("detects binary content", async () => {
		const result = await scanOk(repo);
		expect(await readDiff(repo, entry(result, "bin.dat"), { signal: signal(), force: false })).toEqual({
			kind: "binary",
		});
	});

	it("shows symlink targets instead of following them", async () => {
		const result = await scanOk(repo);
		expect(await readDiff(repo, entry(result, "link"), { signal: signal(), force: false })).toMatchObject({
			kind: "text",
			original: "tracked.txt",
			modified: "staged.txt",
		});
	});

	it.skipIf(!rawNamesSupported())("reads files whose names are not valid UTF-8", async () => {
		const dir = makeRepo("raw-names");
		fs.writeFileSync(Buffer.concat([Buffer.from(`${dir}/`), RAW_NAME]), "?");
		const result = await scanOk(dir);
		const odd = result.entries.find((e) => e.raw !== null);
		if (!odd) throw new Error("expected a lossy path");
		expect(await readDiff(dir, odd, { signal: signal(), force: false })).toMatchObject({
			kind: "text",
			modified: "?",
		});
	});

	it("flags content that is not valid UTF-8 as lossy", async () => {
		const dir = makeRepo("latin");
		write(path.join(dir, "l.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
		const result = await scanOk(dir);
		expect(await readDiff(dir, entry(result, "l.txt"), { signal: signal(), force: false })).toMatchObject({
			kind: "text",
			lossy: true,
		});
	});

	it("refuses big files until forced and caps them at the hard limit", async () => {
		const dir = makeRepo("big");
		const line = "x".repeat(99) + "\n";
		write(path.join(dir, "soft.txt"), line.repeat(Math.ceil((SOFT_LIMIT + 10) / 100)));
		write(path.join(dir, "hard.txt"), line.repeat(Math.ceil((HARD_LIMIT + 10) / 100)));
		const result = await scanOk(dir);
		expect(await readDiff(dir, entry(result, "soft.txt"), { signal: signal(), force: false })).toMatchObject({
			kind: "too-large",
			canForce: true,
		});
		expect(await readDiff(dir, entry(result, "soft.txt"), { signal: signal(), force: true })).toMatchObject({
			kind: "text",
		});
		expect(await readDiff(dir, entry(result, "hard.txt"), { signal: signal(), force: true })).toMatchObject({
			kind: "too-large",
			canForce: false,
		});
	});

	it("reports a file deleted after the scan as gone", async () => {
		const dir = makeRepo("vanish");
		write(path.join(dir, "v.txt"), "v\n");
		const result = await scanOk(dir);
		fs.rmSync(path.join(dir, "v.txt"));
		expect(await readDiff(dir, entry(result, "v.txt"), { signal: signal(), force: false })).toEqual({
			kind: "gone",
		});
	});

	it("does not open nested repositories or submodules", async () => {
		const dir = makeRepo("outer");
		const inner = path.join(dir, "inner");
		fs.mkdirSync(inner);
		git(inner, "init", "-q", "-b", "main");
		write(path.join(inner, "i.txt"), "i\n");
		git(inner, "add", ".");
		git(inner, "commit", "-q", "-m", "i");
		const result = await scanOk(dir);
		expect(result.entries.map((e) => e.path)).toEqual(["inner/"]);
		expect(await readDiff(dir, result.entries[0], { signal: signal(), force: false })).toEqual({
			kind: "directory",
		});
	});
});
