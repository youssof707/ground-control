import { describe, expect, it } from "vitest";
import { RefreshScheduler, type RefreshRun } from "./scmScheduler";

function setup() {
	let now = 0;
	const timers: Array<{ at: number; fn: () => void; id: number }> = [];
	let nextTimer = 1;
	const runs: Array<{ checkout: string; finish: (d: number | null) => void; cancelled: boolean }> = [];
	const scheduler = new RefreshScheduler({
		now: () => now,
		setTimer: (fn, ms) => {
			const id = nextTimer++;
			timers.push({ at: now + ms, fn, id });
			return id;
		},
		clearTimer: (id) => {
			const i = timers.findIndex((t) => t.id === id);
			if (i !== -1) timers.splice(i, 1);
		},
		run: (checkout): RefreshRun => {
			let finish!: (d: number | null) => void;
			const promise = new Promise<number | null>((r) => {
				finish = r;
			});
			const run = { checkout, finish, cancelled: false };
			runs.push(run);
			return {
				promise,
				cancel: () => {
					run.cancelled = true;
					finish(null);
				},
			};
		},
	});
	const advance = async (ms: number): Promise<void> => {
		now += ms;
		for (const t of [...timers].sort((a, b) => a.at - b.at)) {
			if (t.at > now) continue;
			timers.splice(timers.indexOf(t), 1);
			t.fn();
		}
		await Promise.resolve();
		await Promise.resolve();
	};
	return { scheduler, runs, advance, timers };
}

describe("RefreshScheduler", () => {
	it("collapses many requests during a slow scan into one trailing run", async () => {
		const h = setup();
		h.scheduler.request("/r");
		for (let i = 0; i < 100; i++) h.scheduler.request("/r");
		expect(h.runs).toHaveLength(1);
		h.runs[0].finish(500);
		await h.advance(0);
		expect(h.runs).toHaveLength(1);
		await h.advance(2_000);
		expect(h.runs).toHaveLength(2);
	});

	it("waits at least twice the last scan duration between runs", async () => {
		const h = setup();
		h.scheduler.request("/r");
		h.runs[0].finish(10_000);
		await h.advance(0);
		h.scheduler.request("/r");
		await h.advance(19_000);
		expect(h.runs).toHaveLength(1);
		await h.advance(1_000);
		expect(h.runs).toHaveLength(2);
	});

	it("lets urgent requests skip the wait but not overlap a running scan", async () => {
		const h = setup();
		h.scheduler.request("/r");
		h.runs[0].finish(10_000);
		await h.advance(0);
		h.scheduler.request("/r", true);
		expect(h.runs).toHaveLength(2);
		h.scheduler.request("/r", true);
		expect(h.runs).toHaveLength(2);
		h.runs[1].finish(10_000);
		await h.advance(0);
		expect(h.runs).toHaveLength(3);
	});

	it("cancels work for checkouts nobody is looking at", async () => {
		const h = setup();
		h.scheduler.request("/a");
		h.scheduler.request("/b");
		h.scheduler.request("/a");
		h.scheduler.cancelExcept(new Set(["/b"]));
		await h.advance(0);
		expect(h.runs.find((r) => r.checkout === "/a")?.cancelled).toBe(true);
		expect(h.runs.find((r) => r.checkout === "/b")?.cancelled).toBe(false);
		expect(h.runs.filter((r) => r.checkout === "/a")).toHaveLength(1);
	});

	it("keeps checkouts independent", () => {
		const h = setup();
		h.scheduler.request("/a");
		h.scheduler.request("/b");
		expect(h.runs.map((r) => r.checkout)).toEqual(["/a", "/b"]);
	});
});
