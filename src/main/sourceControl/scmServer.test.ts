import { describe, expect, it } from "vitest";
import type { ScmAction, ScmDiffContent, ScmReply } from "../../shared/schemas/source_control";
import type { ApplyTarget } from "./apply";
import type { StatusEntry } from "./parseStatus";
import type { ScanResult } from "./scan";
import { ScmServer } from "./scmServer";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function entry(path: string): StatusEntry {
	return {
		path,
		raw: null,
		status: "M",
		staged: false,
		baseOid: null,
		targetOid: null,
		baseMode: null,
		targetMode: null,
		submodule: false,
	};
}

function okScan(paths: string[]): ScanResult {
	return {
		ok: true,
		root: "/repo",
		worktreeName: null,
		header: { branch: "main", head: "abc1234", unborn: false, upstream: "origin/main", ahead: 2, behind: 3 },
		entries: paths.map(entry),
		stagedListed: 0,
		staged: 0,
		unstaged: paths.length,
		changed: paths.length,
		conflicts: 0,
		unpublished: null,
		worktrees: [{ path: "/repo", branch: "main", head: "abc1234", isMain: true }],
		durationMs: 1,
	};
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function harness(options: {
	scan?: (checkout: string, signal: AbortSignal) => Promise<ScanResult>;
	diff?: (entry: StatusEntry, signal: AbortSignal) => Promise<ScmDiffContent>;
	apply?: (action: ScmAction, target: ApplyTarget) => Promise<void>;
	watchHead?: (checkout: string, signal: AbortSignal) => Promise<void>;
}) {
	const replies: ScmReply[] = [];
	const scans: Array<{ checkout: string; signal: AbortSignal }> = [];
	const server = new ScmServer({
		cap: 100,
		scan: (checkout, { signal }) => {
			scans.push({ checkout, signal });
			return options.scan ? options.scan(checkout, signal) : Promise.resolve(okScan(["a", "b", "c"]));
		},
		apply: (action, target) => (options.apply ? options.apply(action, target) : Promise.resolve()),
		branches: () => Promise.resolve({ current: "main", worktreeName: null, branches: [], fetchedAt: 0 }),
		remote: (checkout, op) =>
			checkout === "/fail" ? Promise.reject(new Error(`${op} rejected`)) : Promise.resolve(),
		watchHead: (checkout, signal) =>
			options.watchHead ? options.watchHead(checkout, signal) : new Promise<void>(() => undefined),
		switchBranch: (_checkout, branch) =>
			branch === "missing" ? Promise.reject(new Error("invalid reference: missing")) : Promise.resolve(),
		diff: (_checkout, e, { signal }) =>
			options.diff
				? options.diff(e, signal)
				: Promise.resolve({ kind: "text", original: "", modified: e.path, lossy: false }),
	});
	const conn = server.connect((r) => replies.push(r));
	return { server, conn, replies, scans };
}

describe("ScmServer", () => {
	it("reports upstream and ahead/behind in the summary", async () => {
		const { conn, replies } = harness({});
		conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		const reply = replies[0];
		expect(reply.t === "scan" && reply.ok && [reply.summary.upstream, reply.summary.ahead, reply.summary.behind]).toEqual([
			"origin/main",
			2,
			3,
		]);
	});

	it("runs remote ops and returns git's message on failure", async () => {
		const { conn, replies } = harness({});
		conn.handle({ t: "remote", id: 1, checkout: "/repo", op: "push" });
		conn.handle({ t: "remote", id: 2, checkout: "/fail", op: "pull" });
		await flush();
		await flush();
		expect(replies).toContainEqual({ t: "remote", id: 1, ok: true });
		expect(replies).toContainEqual({ t: "remote", id: 2, ok: false, reason: "failed", message: "pull rejected" });
	});

	it("joins scan requests that arrive during a scan into one trailing rerun", async () => {
		const runs: Deferred<ScanResult>[] = [];
		const h = harness({
			scan: () => {
				const d = deferred<ScanResult>();
				runs.push(d);
				return d.promise;
			},
		});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		for (let id = 2; id <= 100; id++) h.conn.handle({ t: "scan", id, checkout: "/repo" });
		await flush();
		expect(h.scans).toHaveLength(1);
		runs[0].resolve(okScan(["a"]));
		await flush();
		expect(h.replies.map((r) => r.id)).toEqual([1]);
		expect(h.scans).toHaveLength(2);
		runs[1].resolve(okScan(["a", "b"]));
		await flush();
		expect(h.replies).toHaveLength(100);
		expect(h.scans).toHaveLength(2);
	});

	it("kills a scan once nobody is waiting for it", async () => {
		const h = harness({
			scan: (_c, signal) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }));
				}),
		});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		h.conn.handle({ t: "cancel", id: 1 });
		expect(h.scans[0].signal.aborted).toBe(true);
	});

	it("caps concurrent scans across checkouts", async () => {
		const h = harness({ scan: () => new Promise(() => undefined) });
		h.conn.handle({ t: "scan", id: 1, checkout: "/a" });
		h.conn.handle({ t: "scan", id: 2, checkout: "/b" });
		h.conn.handle({ t: "scan", id: 3, checkout: "/c" });
		await flush();
		expect(h.scans.map((s) => s.checkout)).toEqual(["/a", "/b"]);
	});

	it("serves rows for the current scan and refuses stale ones", async () => {
		const h = harness({});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		const scan = h.replies[0];
		if (scan.t !== "scan" || !scan.ok) throw new Error("scan failed");
		h.conn.handle({ t: "rows", id: 2, checkout: "/repo", scanId: scan.summary.scanId, offset: 1, limit: 5 });
		h.conn.handle({ t: "rows", id: 3, checkout: "/repo", scanId: scan.summary.scanId + 1, offset: 0, limit: 5 });
		expect(h.replies[1]).toEqual({ t: "rows", id: 2, ok: true, offset: 1, paths: ["b", "c"], status: "MM" });
		expect(h.replies[2]).toEqual({ t: "rows", id: 3, ok: false, reason: "stale" });
	});

	it("serves a diff even when two scans are running", async () => {
		const h = harness({
			scan: (checkout) =>
				checkout === "/repo" ? Promise.resolve(okScan(["a", "b", "c"])) : new Promise(() => undefined),
		});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		const scan = h.replies[0];
		if (scan.t !== "scan" || !scan.ok) throw new Error("scan failed");
		h.conn.handle({ t: "scan", id: 2, checkout: "/x" });
		h.conn.handle({ t: "scan", id: 3, checkout: "/y" });
		h.conn.handle({ t: "diff", id: 4, checkout: "/repo", scanId: scan.summary.scanId, index: 2, path: "c", staged: false, force: false });
		await flush();
		expect(h.replies.find((r) => r.id === 4)).toMatchObject({ ok: true, content: { modified: "c" } });
	});

	it("finds a file by path when the list moved under it", async () => {
		const h = harness({});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		h.conn.handle({ t: "diff", id: 2, checkout: "/repo", scanId: 0, index: 0, path: "c", staged: false, force: false });
		h.conn.handle({ t: "diff", id: 3, checkout: "/repo", scanId: 0, index: 0, path: "zzz", staged: false, force: false });
		await flush();
		expect(h.replies.find((r) => r.id === 2)).toMatchObject({ ok: true, content: { modified: "c" } });
		expect(h.replies.find((r) => r.id === 3)).toEqual({ t: "diff", id: 3, ok: false, reason: "stale" });
	});

	it("aborts a cancelled diff", async () => {
		const signals: AbortSignal[] = [];
		const h = harness({
			diff: (_e, signal) => {
				signals.push(signal);
				return new Promise(() => undefined);
			},
		});
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		h.conn.handle({ t: "diff", id: 2, checkout: "/repo", scanId: 1, index: 0, path: "a", staged: false, force: false });
		await flush();
		h.conn.handle({ t: "cancel", id: 2 });
		expect(signals[0].aborted).toBe(true);
	});

	it("cancels everything when the connection closes", async () => {
		const h = harness({ scan: () => new Promise(() => undefined) });
		h.conn.handle({ t: "scan", id: 1, checkout: "/repo" });
		await flush();
		h.conn.close();
		expect(h.scans[0].signal.aborted).toBe(true);
	});

	it("ignores malformed messages", async () => {
		const h = harness({});
		h.conn.handle(null);
		h.conn.handle({ t: "scan", id: 1, checkout: "relative" });
		h.conn.handle({ t: "nope", id: 2 });
		await flush();
		expect(h.replies).toEqual([]);
		expect(h.scans).toEqual([]);
	});

	it("resolves apply picks against the cached list and reports git errors", async () => {
		const seen: Array<{ action: ScmAction; staged: string[] | "all"; unstaged: string[] | "all" }> = [];
		const h = harness({
			apply: (action, target) => {
				const names = (p: ApplyTarget["staged"]) => (p === "all" ? "all" : p.map((e) => e.path));
				seen.push({ action, staged: names(target.staged), unstaged: names(target.unstaged) });
				return action === "discard" ? Promise.reject(new Error("boom")) : Promise.resolve();
			},
		});
		h.conn.handle({ t: "apply", id: 1, checkout: "/repo", action: "stage", staged: [], unstaged: ["a"] });
		await flush();
		expect(h.replies).toEqual([{ t: "apply", id: 1, ok: false, reason: "stale" }]);
		h.conn.handle({ t: "scan", id: 2, checkout: "/repo" });
		await flush();
		h.conn.handle({ t: "apply", id: 3, checkout: "/repo", action: "stage", staged: [], unstaged: ["a", "zzz", "c"] });
		h.conn.handle({ t: "apply", id: 4, checkout: "/repo", action: "discard", staged: "all", unstaged: "all" });
		await flush();
		await flush();
		expect(seen).toEqual([
			{ action: "stage", staged: [], unstaged: ["a", "c"] },
			{ action: "discard", staged: "all", unstaged: "all" },
		]);
		expect(h.replies.filter((r) => r.t === "apply").slice(1)).toEqual([
			{ t: "apply", id: 3, ok: true },
			{ t: "apply", id: 4, ok: false, reason: "failed", message: "boom" },
		]);
	});

	it("lists branches and reports switch failures with git's message", async () => {
		const h = harness({});
		h.conn.handle({ t: "branches", id: 1, checkout: "/repo" });
		h.conn.handle({ t: "switch", id: 2, checkout: "/repo", branch: "feature", remote: false });
		h.conn.handle({ t: "switch", id: 3, checkout: "/repo", branch: "missing", remote: false });
		h.conn.handle({ t: "switch", id: 4, checkout: "relative", branch: "x", remote: false });
		await flush();
		await flush();
		expect(h.replies).toEqual([
			{ t: "branches", id: 1, ok: true, list: { current: "main", worktreeName: null, branches: [], fetchedAt: 0 } },
			{ t: "switch", id: 2, ok: true },
			{ t: "switch", id: 3, ok: false, reason: "failed", message: "invalid reference: missing" },
		]);
	});

	it("replies when HEAD moves and when a head watch is cancelled", async () => {
		const moved = deferred<void>();
		const signals: AbortSignal[] = [];
		const h = harness({
			watchHead: (checkout, signal) => {
				signals.push(signal);
				if (checkout === "/repo") return moved.promise;
				return new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")));
				});
			},
		});
		h.conn.handle({ t: "watchHead", id: 1, checkout: "/repo" });
		h.conn.handle({ t: "watchHead", id: 2, checkout: "/other" });
		h.conn.handle({ t: "watchHead", id: 3, checkout: "relative" });
		await flush();
		expect(signals).toHaveLength(2);
		moved.resolve();
		h.conn.handle({ t: "cancel", id: 2 });
		await flush();
		expect(signals[1].aborted).toBe(true);
		expect(h.replies).toHaveLength(2);
		expect(h.replies).toContainEqual({ t: "watchHead", id: 1, ok: true });
		expect(h.replies).toContainEqual({ t: "watchHead", id: 2, ok: false, reason: "cancelled" });
	});
});
