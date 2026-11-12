import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logActivity = vi.hoisted(() => vi.fn());

vi.mock("../windows", () => ({ broadcast: vi.fn() }));
vi.mock("../activityLog", () => ({
	logActivity,
	describeError: (err: unknown) => String(err),
}));
vi.mock("./wakeScheduler", () => ({
	scheduleWake: vi.fn(() => Promise.resolve(null)),
	cancelWake: vi.fn(() => Promise.resolve()),
}));

import {
	MAX_RESUME_ATTEMPTS,
	RESUME_GRACE_MS,
	UsageLimitResumer,
	type PendingResumeStore,
	type SavedResumeEntry,
} from "./UsageLimitResumer";
import type { SessionStatus } from "../../shared/claude-sessions/types";

const START = new Date(2026, 10, 11, 12, 0, 0).getTime();

function makeStore(saved: SavedResumeEntry[] = []): PendingResumeStore & {
	save: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
} {
	return {
		list: () => saved,
		save: vi.fn(() => Promise.resolve()),
		remove: vi.fn(() => Promise.resolve()),
	};
}

function makeResumer(opts: {
	autoResume?: boolean;
	status?: (id: string) => SessionStatus | undefined;
	store?: PendingResumeStore;
}) {
	const retry = vi.fn(() => Promise.resolve());
	const resumer = new UsageLimitResumer({
		autoResume: () => opts.autoResume ?? true,
		status: opts.status ?? (() => "usage_limit"),
		retry,
		latestResetMs: () => undefined,
		store: opts.store,
		now: () => Date.now(),
	});
	return { resumer, retry };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(START);
	logActivity.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("UsageLimitResumer retry cap", () => {
	it(`gives up after ${MAX_RESUME_ATTEMPTS} attempts`, async () => {
		const store = makeStore();
		const { resumer, retry } = makeResumer({ store });
		for (let i = 0; i <= MAX_RESUME_ATTEMPTS; i++) {
			resumer.onLimitHit("s1", Date.now() + 60_000);
			await vi.advanceTimersByTimeAsync(60_000 + RESUME_GRACE_MS + 1);
		}
		expect(retry).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
		expect(resumer.isPending("s1")).toBe(false);
		expect(store.remove).toHaveBeenCalledWith("s1");
		expect(logActivity).toHaveBeenCalledWith("auto-resume", `s1 gave up after ${MAX_RESUME_ATTEMPTS} attempts`);
	});
});

describe("UsageLimitResumer restore", () => {
	it("re-arms saved entries still at usage limit and drops the rest", () => {
		const store = makeStore([
			{ runtimeId: "live", resumeAt: START + 600_000, attempts: 2 },
			{ runtimeId: "done", resumeAt: START + 600_000, attempts: 0 },
		]);
		const { resumer } = makeResumer({
			autoResume: false,
			store,
			status: (id) => (id === "live" ? "usage_limit" : "idle"),
		});
		resumer.restore();
		expect(resumer.isPending("live")).toBe(true);
		expect(resumer.isPending("done")).toBe(false);
		expect(store.remove).toHaveBeenCalledWith("done");
	});

	it("keeps restored entries without a babysitter config and retries them", async () => {
		const store = makeStore([{ runtimeId: "s1", resumeAt: START + 600_000, attempts: 1 }]);
		const { resumer, retry } = makeResumer({ autoResume: false, store });
		resumer.restore();
		resumer.refresh("s1", undefined);
		expect(resumer.isPending("s1")).toBe(true);
		await vi.advanceTimersByTimeAsync(600_001);
		expect(retry).toHaveBeenCalledWith("s1");
		expect(store.save).toHaveBeenLastCalledWith({ runtimeId: "s1", resumeAt: START + 600_000, attempts: 2 });
		resumer.onLimitHit("s1", Date.now() + 60_000);
		expect(resumer.isPending("s1")).toBe(true);
	});

	it("removes the saved entry on cancel", () => {
		const store = makeStore([{ runtimeId: "s1", resumeAt: START + 600_000, attempts: 0 }]);
		const { resumer } = makeResumer({ store });
		resumer.restore();
		resumer.cancel("s1");
		expect(store.remove).toHaveBeenCalledWith("s1");
	});
});
