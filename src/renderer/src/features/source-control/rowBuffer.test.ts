import { describe, expect, it } from "vitest";
import type { ScmRowsReply, ScmSummary } from "@shared/schemas/source_control";
import { canReuse, createBuffer, fillRows, locate, statusAt } from "./rowBuffer";

function summary(listed: number, extra: Partial<ScmSummary> = {}): ScmSummary {
	return {
		checkout: "/repo",
		scanId: 1,
		branch: "main",
		head: "abc1234",
		unborn: false,
		changed: listed,
		staged: 0,
		unstaged: listed,
		listed,
		stagedListed: 0,
		conflicts: 0,
		fingerprint: `fp-${listed}`,
		worktrees: [],
		worktreeName: null,
		upstream: null,
		ahead: 0,
		behind: 0,
		unpublished: null,
		fetchedAt: 0,
		durationMs: 1,
		...extra,
	};
}

function server(total: number) {
	const calls: Array<{ offset: number; limit: number }> = [];
	let id = 0;
	const fetchRows = (offset: number, limit: number) => {
		calls.push({ offset, limit });
		const count = Math.max(0, Math.min(limit, total - offset));
		const reply: ScmRowsReply = {
			t: "rows",
			id: ++id,
			ok: true,
			offset,
			paths: Array.from({ length: count }, (_, i) => `f${offset + i}`),
			status: "M".repeat(count),
		};
		return { id, promise: Promise.resolve(reply) };
	};
	return { calls, fetchRows };
}

const noop = { cancelled: () => false, onCall: () => undefined, onBatch: () => undefined };

describe("fillRows", () => {
	it("loads the list in bounded batches", async () => {
		const s = server(4_500);
		const buffer = createBuffer(summary(4_500));
		let batches = 0;
		expect(await fillRows(buffer, s.fetchRows, { ...noop, onBatch: () => batches++ })).toBe("done");
		expect(buffer.paths).toHaveLength(4_500);
		expect(buffer.paths[4_499]).toBe("f4499");
		expect(statusAt(buffer, 10)).toBe("M");
		expect(buffer.complete).toBe(true);
		expect(s.calls.map((c) => c.offset)).toEqual([0, 2_000, 4_000]);
		expect(Math.max(...s.calls.map((c) => c.limit))).toBeLessThanOrEqual(2_000);
		expect(batches).toBe(3);
	});

	it("stops when cancelled", async () => {
		const s = server(10_000);
		const buffer = createBuffer(summary(10_000));
		let cancelled = false;
		const result = await fillRows(buffer, s.fetchRows, {
			...noop,
			cancelled: () => cancelled,
			onBatch: () => {
				cancelled = true;
			},
		});
		expect(result).toBe("cancelled");
		expect(buffer.complete).toBe(false);
		expect(s.calls).toHaveLength(1);
	});

	it("reports a stale scan", async () => {
		const buffer = createBuffer(summary(10));
		const result = await fillRows(
			buffer,
			() => ({ id: 1, promise: Promise.resolve({ t: "rows", id: 1, ok: false, reason: "stale" } as const) }),
			noop,
		);
		expect(result).toBe("stale");
	});

	it("treats an empty list as already complete", async () => {
		const buffer = createBuffer(summary(0));
		expect(buffer.complete).toBe(true);
		expect(await fillRows(buffer, server(0).fetchRows, noop)).toBe("done");
	});
});

describe("canReuse and locate", () => {
	it("reuses a complete buffer when the list did not change", async () => {
		const buffer = createBuffer(summary(3));
		await fillRows(buffer, server(3).fetchRows, noop);
		expect(canReuse(buffer, summary(3, { scanId: 2 }))).toBe(true);
		expect(canReuse(buffer, summary(3, { fingerprint: "other" }))).toBe(false);
		expect(canReuse(buffer, summary(3, { checkout: "/elsewhere" }))).toBe(false);
	});

	it("finds a row by hint first, then by key", async () => {
		const buffer = createBuffer(summary(5, { stagedListed: 2 }));
		await fillRows(buffer, server(5).fetchRows, noop);
		expect(locate(buffer, "Wf3", 3)).toBe(3);
		expect(locate(buffer, "Wf3", 0)).toBe(3);
		expect(locate(buffer, "Sf1")).toBe(1);
		expect(locate(buffer, "Wf1")).toBe(-1);
		expect(locate(buffer, "Wmissing", 0)).toBe(-1);
	});
});
