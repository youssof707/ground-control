import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
	MIN_SCHEDULE_INTERVAL_MS,
	type CreateScheduleInput,
	type Schedule,
	type ScheduleKind,
	type UpdateScheduleInput,
} from "../../shared/schemas/schedules";

export const CONTROL_SERVER_NAME = "ground-control";
export const LIST_SCHEDULES_TOOL_NAME = `mcp__${CONTROL_SERVER_NAME}__list_schedules`;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const TimeSchema = z
	.string()
	.regex(TIME_PATTERN, "Use 24-hour HH:MM, e.g. 09:30")
	.describe("Local 24-hour time, HH:MM");

export const TimingSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("once"),
		at: z
			.string()
			.describe("Local date and time, e.g. 2026-11-27T09:00"),
	}),
	z.object({
		type: z.literal("repeat"),
		every: z.number().positive(),
		unit: z.enum(["minutes", "hours"]),
	}),
	z.object({ type: z.literal("daily"), time: TimeSchema }),
	z.object({
		type: z.literal("weekly"),
		days: z.array(z.enum(WEEKDAYS)).min(1).max(7),
		time: TimeSchema,
	}),
]);
export type Timing = z.infer<typeof TimingSchema>;

function minuteOfDay(time: string): number {
	const match = TIME_PATTERN.exec(time);
	if (!match) throw new Error("Use 24-hour HH:MM, e.g. 09:30");
	return Number(match[1]) * 60 + Number(match[2]);
}

function hhmm(minutes: number): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function localIso(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function kindFromTiming(timing: Timing): ScheduleKind {
	switch (timing.type) {
		case "once": {
			const at = new Date(timing.at).getTime();
			if (Number.isNaN(at)) {
				throw new Error("Use a local date and time like 2026-11-27T09:00");
			}
			return { type: "once", at };
		}
		case "repeat": {
			const everyMs = Math.round(
				timing.every * (timing.unit === "hours" ? HOUR_MS : MINUTE_MS),
			);
			if (everyMs < MIN_SCHEDULE_INTERVAL_MS) {
				throw new Error("Repeat interval must be at least 1 minute");
			}
			return { type: "repeat", everyMs };
		}
		case "daily":
			return { type: "daily", minuteOfDay: minuteOfDay(timing.time) };
		case "weekly":
			return {
				type: "weekly",
				days: [...new Set(timing.days.map((d) => WEEKDAYS.indexOf(d)))].sort(
					(a, b) => a - b,
				),
				minuteOfDay: minuteOfDay(timing.time),
			};
	}
}

export function timingFromKind(kind: ScheduleKind): Timing {
	switch (kind.type) {
		case "once":
			return { type: "once", at: localIso(kind.at) };
		case "repeat":
			return kind.everyMs % HOUR_MS === 0
				? { type: "repeat", every: kind.everyMs / HOUR_MS, unit: "hours" }
				: { type: "repeat", every: kind.everyMs / MINUTE_MS, unit: "minutes" };
		case "daily":
			return { type: "daily", time: hhmm(kind.minuteOfDay) };
		case "weekly":
			return {
				type: "weekly",
				days: kind.days.map((d) => WEEKDAYS[d]),
				time: hhmm(kind.minuteOfDay),
			};
	}
}

export function describeSchedule(s: Schedule) {
	return {
		id: s.id,
		name: s.title,
		prompt: s.prompt,
		folder: s.cwd,
		model: s.model ?? null,
		timing: timingFromKind(s.kind),
		enabled: s.enabled,
		nextRun: s.nextFireAt ? localIso(s.nextFireAt) : null,
		lastRun: s.lastFiredAt ? localIso(s.lastFiredAt) : null,
		status: s.status ? { color: s.status.color, line: s.status.line } : null,
	};
}

export interface SchedulePatch {
	name?: string;
	prompt?: string;
	folder?: string;
	model?: string;
	timing?: Timing;
}

export function mergeUpdate(
	current: Schedule,
	patch: SchedulePatch,
): UpdateScheduleInput {
	return {
		id: current.id,
		title: patch.name ?? current.title,
		prompt: patch.prompt ?? current.prompt,
		cwd: patch.folder ?? current.cwd,
		model: patch.model ?? current.model,
		kind: patch.timing ? kindFromTiming(patch.timing) : current.kind,
	};
}

export interface ScheduleControlDeps {
	list: () => Schedule[];
	get: (id: string) => Schedule | undefined;
	create: (input: CreateScheduleInput) => Promise<Schedule>;
	update: (input: UpdateScheduleInput) => Promise<Schedule>;
}

const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

async function guarded(run: () => Promise<unknown> | unknown) {
	try {
		return json(await run());
	} catch (err) {
		return {
			content: [
				{
					type: "text" as const,
					text: err instanceof Error ? err.message : String(err),
				},
			],
			isError: true,
		};
	}
}

const fields = {
	name: z.string().describe("Short name shown in the Tasks widget"),
	prompt: z.string().min(1).describe("What Claude is asked to do on each run"),
	folder: z.string().min(1).describe("Absolute path of the folder the run works in"),
	model: z.string().describe("Model id or alias, e.g. sonnet or opus"),
	timing: TimingSchema.describe("When the task runs, in local time"),
};

export function createScheduleControlServer(deps: ScheduleControlDeps) {
	return createSdkMcpServer({
		name: CONTROL_SERVER_NAME,
		version: "1.0.0",
		alwaysLoad: true,
		tools: [
			tool(
				"list_schedules",
				"List the user's Ground Control scheduled tasks with their timing, prompt, model, folder, next run and latest status.",
				{},
				async () => guarded(() => deps.list().map(describeSchedule)),
			),
			tool(
				"create_schedule",
				"Create a Ground Control scheduled task. It starts enabled.",
				{
					name: fields.name.optional(),
					prompt: fields.prompt,
					folder: fields.folder,
					model: fields.model.optional(),
					timing: fields.timing,
				},
				async ({ name, prompt, folder, model, timing }) =>
					guarded(async () =>
						describeSchedule(
							await deps.create({
								title: name,
								prompt,
								cwd: folder,
								model,
								kind: kindFromTiming(timing),
							}),
						),
					),
			),
			tool(
				"update_schedule",
				"Edit a Ground Control scheduled task. Only the fields you pass change.",
				{
					id: z.string().describe("Task id from list_schedules"),
					name: fields.name.optional(),
					prompt: fields.prompt.optional(),
					folder: fields.folder.optional(),
					model: fields.model.optional(),
					timing: fields.timing.optional(),
				},
				async ({ id, ...patch }) =>
					guarded(async () => {
						const current = deps.get(id);
						if (!current) throw new Error("Task not found");
						return describeSchedule(
							await deps.update(mergeUpdate(current, patch)),
						);
					}),
			),
		],
	});
}
