import { describe, expect, it } from "vitest";
import type { Schedule } from "../../shared/schemas/schedules";
import {
	describeSchedule,
	kindFromTiming,
	mergeUpdate,
	timingFromKind,
	type Timing,
} from "./scheduleControlTool";

const babysit = {
	plan: "ask",
	permission: "ask",
	question: "ask",
	keepAwake: true,
	autoResume: true,
} as unknown as Schedule["babysit"];

const schedule: Schedule = {
	id: "s1",
	title: "Nightly",
	prompt: "check disks",
	cwd: "/tmp",
	model: "sonnet",
	kind: { type: "daily", minuteOfDay: 9 * 60 + 5 },
	babysit,
	enabled: true,
	alwaysShowStatus: true,
	createdAt: 0,
};

describe("timing conversion", () => {
	it.each<Timing>([
		{ type: "repeat", every: 30, unit: "minutes" },
		{ type: "repeat", every: 2, unit: "hours" },
		{ type: "daily", time: "09:05" },
		{ type: "weekly", days: ["mon", "wed", "fri"], time: "18:30" },
		{ type: "once", at: "2030-01-02T03:04" },
	])("round-trips %o", (timing) => {
		expect(timingFromKind(kindFromTiming(timing))).toEqual(timing);
	});

	it("maps weekday names to getDay numbers, sorted and unique", () => {
		expect(
			kindFromTiming({ type: "weekly", days: ["sun", "sat", "sun"], time: "7:00" }),
		).toEqual({ type: "weekly", days: [0, 6], minuteOfDay: 420 });
	});

	it("parses once as local time", () => {
		const kind = kindFromTiming({ type: "once", at: "2030-01-02T03:04" });
		expect(kind).toEqual({
			type: "once",
			at: new Date(2030, 0, 2, 3, 4).getTime(),
		});
	});

	it("rejects a bad time, a bad date and a sub-minute repeat", () => {
		expect(() => kindFromTiming({ type: "daily", time: "25:00" })).toThrow();
		expect(() => kindFromTiming({ type: "once", at: "tomorrow" })).toThrow();
		expect(() =>
			kindFromTiming({ type: "repeat", every: 0.5, unit: "minutes" }),
		).toThrow();
	});
});

describe("mergeUpdate", () => {
	it("keeps unspecified fields and never carries babysit or always-show", () => {
		const input = mergeUpdate(schedule, { prompt: "check memory" });
		expect(input).toEqual({
			id: "s1",
			title: "Nightly",
			prompt: "check memory",
			cwd: "/tmp",
			model: "sonnet",
			kind: schedule.kind,
		});
		expect("babysit" in input).toBe(false);
		expect("alwaysShowStatus" in input).toBe(false);
	});

	it("applies new timing, name, folder and model", () => {
		expect(
			mergeUpdate(schedule, {
				name: "Hourly",
				folder: "/var",
				model: "opus",
				timing: { type: "repeat", every: 1, unit: "hours" },
			}),
		).toMatchObject({
			title: "Hourly",
			cwd: "/var",
			model: "opus",
			kind: { type: "repeat", everyMs: 3_600_000 },
		});
	});
});

describe("describeSchedule", () => {
	it("leaves out babysit settings", () => {
		expect(describeSchedule(schedule)).not.toHaveProperty("babysit");
	});
});
