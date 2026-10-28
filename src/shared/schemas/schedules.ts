import { z } from "zod";
import { BabysitConfigSchema } from "./app_settings";

export const MIN_SCHEDULE_INTERVAL_MS = 60_000;
export const DEFAULT_SCHEDULE_KEEP_LAST = 20;
export const MAX_SCHEDULE_KEEP_LAST = 500;
export const MINUTES_PER_DAY = 1440;

export const ScheduleKindSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("once"), at: z.number() }),
	z.object({
		type: z.literal("repeat"),
		everyMs: z.number().int().min(MIN_SCHEDULE_INTERVAL_MS),
	}),
	z.object({
		type: z.literal("daily"),
		minuteOfDay: z.number().int().min(0).max(MINUTES_PER_DAY - 1),
	}),
]);
export type ScheduleKind = z.infer<typeof ScheduleKindSchema>;

function atMinuteOfDay(dayOf: Date, minuteOfDay: number): Date {
	const d = new Date(dayOf);
	d.setHours(0, 0, 0, 0);
	d.setMinutes(minuteOfDay);
	return d;
}

export function nextFireAfter(
	kind: ScheduleKind,
	now: number,
): number | undefined {
	if (kind.type === "once") return kind.at > now ? kind.at : undefined;
	if (kind.type === "repeat") return now + kind.everyMs;
	const today = atMinuteOfDay(new Date(now), kind.minuteOfDay);
	if (today.getTime() > now) return today.getTime();
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	return atMinuteOfDay(tomorrow, kind.minuteOfDay).getTime();
}

const KeepLastSchema = z.number().int().min(1).max(MAX_SCHEDULE_KEEP_LAST);

export const ScheduleSchema = z.object({
	id: z.string(),
	title: z.string().catch(""),
	prompt: z.string(),
	cwd: z.string(),
	model: z.string().optional(),
	kind: ScheduleKindSchema,
	babysit: BabysitConfigSchema.optional().catch(undefined),
	keepLast: KeepLastSchema.catch(DEFAULT_SCHEDULE_KEEP_LAST),
	enabled: z.boolean().catch(true),
	createdAt: z.number(),
	nextFireAt: z.number().optional(),
	lastFiredAt: z.number().optional(),
	lastSessionId: z.string().optional(),
	lastSkippedAt: z.number().optional(),
	lastError: z.string().optional(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const SchedulesFileSchema = z.object({
	items: z.record(z.string(), ScheduleSchema),
});
export type SchedulesFile = z.infer<typeof SchedulesFileSchema>;

export const CreateScheduleInputSchema = z.object({
	title: z.string().optional(),
	prompt: z.string().min(1),
	cwd: z.string().min(1),
	model: z.string().optional(),
	kind: ScheduleKindSchema,
	babysit: BabysitConfigSchema.optional(),
	keepLast: KeepLastSchema.optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;

export const UpdateScheduleInputSchema = CreateScheduleInputSchema.extend({
	id: z.string(),
});
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;

export type SchedulePatch = Partial<Omit<Schedule, "id" | "createdAt">>;
