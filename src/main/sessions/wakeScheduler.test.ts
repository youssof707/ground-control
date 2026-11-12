import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	is: { dev: false },
	execFile: vi.fn(),
	logActivity: vi.fn(),
}));

vi.mock("@electron-toolkit/utils", () => ({ is: mocks.is }));
vi.mock("../windows", () => ({ broadcast: vi.fn() }));
vi.mock("../activityLog", () => ({
	logActivity: mocks.logActivity,
	describeError: (err: unknown) => String(err),
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

import {
	cancelWake,
	diffWakes,
	formatPmsetDate,
	parseOwnedWakes,
	parsePmsetKey,
	scheduleWake,
} from "./wakeScheduler";

const SAMPLE = `Scheduled power events:
 [0]  wake at 11/11/2026 10:58:03 by 'com.apple.alarm.user-invisible-com.apple.calaccessd.travelEngine.periodicRefreshTimer'
 [1]  wake at 11/12/2026 02:59:00 by 'pmset'
 [2]  wake at 11/12/2026 04:59:00 by 'ground-control'
 [3]  wake at 11/12/2026 04:59:00 by 'ground-control'
 [4]  wake at 11/12/2026 04:59:00 by 'ground-control'
 [5]  wake at 11/12/2026 06:59:00 by 'ground-control'
 [6]  poweron at 11/12/2026 07:00:00 by 'ground-control'
 [7]  wake at 05/12/2036 11:27:29 by 'pmset'
 [8]  wake at 05/12/2036 11:27:29 by 'pmset'
`;

const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime();

describe("parseOwnedWakes", () => {
	it("counts only ground-control wakes, keeping duplicates", () => {
		const owned = parseOwnedWakes(SAMPLE);
		expect([...owned]).toEqual([
			["11/12/26 04:59:00", 3],
			["11/12/26 06:59:00", 1],
		]);
	});

	it("ignores untagged wakes", () => {
		expect(parseOwnedWakes(SAMPLE).has("05/12/36 11:27:29")).toBe(false);
	});
});

describe("diffWakes", () => {
	it("cancels every unwanted copy and schedules missing future wakes", () => {
		const owned = parseOwnedWakes(SAMPLE);
		const diff = diffWakes(owned, ["11/12/26 04:59:00", "11/13/26 09:00:00", "11/10/26 09:00:00"], NOW);
		expect(diff.cancel).toEqual(["11/12/26 04:59:00", "11/12/26 04:59:00", "11/12/26 06:59:00"]);
		expect(diff.schedule).toEqual(["11/13/26 09:00:00"]);
	});

	it("cancels everything owned when nothing is wanted", () => {
		expect(diffWakes(parseOwnedWakes(SAMPLE), [], NOW).cancel).toHaveLength(4);
	});
});

describe("parsePmsetKey", () => {
	it("round-trips formatPmsetDate", () => {
		const at = new Date(2026, 10, 12, 4, 59, 0).getTime();
		expect(parsePmsetKey(formatPmsetDate(at))).toBe(at);
	});
});

describe("cancelWake", () => {
	beforeEach(() => {
		mocks.execFile.mockReset();
		mocks.logActivity.mockReset();
	});

	it("skips pmset for a wake that has already passed", async () => {
		mocks.is.dev = true;
		const at = NOW + 60_000;
		const key = await scheduleWake(at, NOW);
		expect(key).toBe(formatPmsetDate(at));
		mocks.is.dev = false;
		await cancelWake(key as string, at + 1000);
		expect(mocks.execFile).not.toHaveBeenCalled();
		expect(mocks.logActivity).toHaveBeenCalledWith("pmset", `wake ${key} released: already passed`);
	});

	it("never calls pmset in dev builds", async () => {
		mocks.is.dev = true;
		const key = await scheduleWake(NOW + 120_000, NOW);
		await cancelWake(key as string, NOW);
		expect(mocks.execFile).not.toHaveBeenCalled();
		mocks.is.dev = false;
	});
});
