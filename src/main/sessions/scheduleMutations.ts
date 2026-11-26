import { ulid } from "ulid";
import * as schedulesStore from "../core/store/schedules";
import { broadcast } from "../windows";
import {
	CreateScheduleInputSchema,
	UpdateScheduleInputSchema,
	nextFireAfter,
	type CreateScheduleInput,
	type Schedule,
	type ScheduleKind,
	type UpdateScheduleInput,
} from "../../shared/schemas/schedules";
import type { ScheduleRunner } from "./ScheduleRunner";
import { requestAuthorization } from "./wakeScheduler";
import { directoryExists } from "./fsUtils";

export const pushSchedules = () =>
	broadcast("schedules:changed", schedulesStore.list());

function assertFuture(kind: ScheduleKind, now: number): void {
	if (kind.type === "once" && kind.at <= now) {
		throw new Error("Pick a time in the future");
	}
}

function kindKey(kind: ScheduleKind): string {
	switch (kind.type) {
		case "once":
			return `once:${kind.at}`;
		case "repeat":
			return `repeat:${kind.everyMs}`;
		case "daily":
			return `daily:${kind.minuteOfDay}`;
		case "weekly":
			return `weekly:${[...kind.days].sort((a, b) => a - b).join(",")}:${kind.minuteOfDay}`;
	}
}

async function validPrompt(prompt: string, cwd: string): Promise<string> {
	const trimmed = prompt.trim();
	if (!trimmed) throw new Error("Prompt is required");
	if (!(await directoryExists(cwd))) {
		throw new Error("Folder does not exist");
	}
	return trimmed;
}

export async function createSchedule(
	runner: ScheduleRunner,
	raw: CreateScheduleInput,
): Promise<Schedule> {
	const input = CreateScheduleInputSchema.parse(raw);
	const prompt = await validPrompt(input.prompt, input.cwd);
	const now = Date.now();
	assertFuture(input.kind, now);
	const schedule = await schedulesStore.create({
		id: ulid(),
		title: (input.title ?? "").trim(),
		prompt,
		cwd: input.cwd,
		model: input.model,
		kind: input.kind,
		babysit: input.babysit,
		alwaysShowStatus: input.alwaysShowStatus ?? false,
		enabled: true,
		createdAt: now,
		nextFireAt: nextFireAfter(input.kind, now),
	});
	void requestAuthorization();
	runner.upsert(schedule);
	pushSchedules();
	return schedule;
}

export async function updateSchedule(
	runner: ScheduleRunner,
	raw: UpdateScheduleInput,
): Promise<Schedule> {
	const input = UpdateScheduleInputSchema.parse(raw);
	const current = schedulesStore.get(input.id);
	if (!current) throw new Error("Task not found");
	const prompt = await validPrompt(input.prompt, input.cwd);
	const now = Date.now();
	const timingChanged = kindKey(current.kind) !== kindKey(input.kind);
	const enabled =
		current.enabled ||
		(timingChanged && input.kind.type === "once" && input.kind.at > now);
	if (enabled && timingChanged) assertFuture(input.kind, now);
	const nextFireAt = !enabled
		? undefined
		: timingChanged
			? nextFireAfter(input.kind, now)
			: current.nextFireAt;
	const updated = await schedulesStore.update(input.id, {
		title: (input.title ?? "").trim(),
		prompt,
		cwd: input.cwd,
		model: input.model,
		kind: input.kind,
		babysit: input.babysit ?? current.babysit,
		alwaysShowStatus: input.alwaysShowStatus ?? current.alwaysShowStatus,
		enabled,
		nextFireAt,
		lastError: undefined,
	});
	if (!updated) throw new Error("Task not found");
	runner.upsert(updated);
	pushSchedules();
	return updated;
}
