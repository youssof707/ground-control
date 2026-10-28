import { ipcMain } from "electron";
import { ulid } from "ulid";
import * as schedulesStore from "../core/store/schedules";
import { broadcast } from "../windows";
import {
	CreateScheduleInputSchema,
	DEFAULT_SCHEDULE_KEEP_LAST,
	UpdateScheduleInputSchema,
	nextFireAfter,
	type CreateScheduleInput,
	type ScheduleKind,
	type UpdateScheduleInput,
} from "../../shared/schemas/schedules";
import type { ScheduleRunner } from "../sessions/ScheduleRunner";
import { requestAuthorization } from "../sessions/wakeScheduler";
import { directoryExists } from "../sessions/fsUtils";

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
	}
}

export function registerSchedulesHandlers(runner: ScheduleRunner): void {
	const push = () => broadcast("schedules:changed", schedulesStore.list());

	ipcMain.handle("schedules:list", () => schedulesStore.list());

	ipcMain.handle("schedules:create", async (_e, raw: CreateScheduleInput) => {
		const input = CreateScheduleInputSchema.parse(raw);
		const prompt = input.prompt.trim();
		if (!prompt) throw new Error("Prompt is required");
		if (!(await directoryExists(input.cwd))) {
			throw new Error("Folder does not exist");
		}
		const now = Date.now();
		assertFuture(input.kind, now);
		const schedule = await schedulesStore.create({
			id: ulid(),
			title: (input.title ?? "").trim(),
			prompt,
			cwd: input.cwd,
			mode: input.mode ?? "acceptEdits",
			model: input.model,
			kind: input.kind,
			keepLast: input.keepLast ?? DEFAULT_SCHEDULE_KEEP_LAST,
			enabled: true,
			createdAt: now,
			nextFireAt: nextFireAfter(input.kind, now),
		});
		void requestAuthorization();
		runner.upsert(schedule);
		push();
		return schedule;
	});

	ipcMain.handle("schedules:update", async (_e, raw: UpdateScheduleInput) => {
		const input = UpdateScheduleInputSchema.parse(raw);
		const current = schedulesStore.get(input.id);
		if (!current) throw new Error("Schedule not found");
		const prompt = input.prompt.trim();
		if (!prompt) throw new Error("Prompt is required");
		if (!(await directoryExists(input.cwd))) {
			throw new Error("Folder does not exist");
		}
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
			mode: input.mode ?? current.mode,
			model: input.model,
			kind: input.kind,
			keepLast: input.keepLast ?? current.keepLast,
			enabled,
			nextFireAt,
			lastError: undefined,
		});
		if (!updated) throw new Error("Schedule not found");
		runner.upsert(updated);
		push();
		return updated;
	});

	ipcMain.handle(
		"schedules:setEnabled",
		async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
			const current = schedulesStore.get(id);
			if (!current) throw new Error("Schedule not found");
			const now = Date.now();
			let patch: Parameters<typeof schedulesStore.update>[1];
			if (enabled) {
				if (current.kind.type === "once" && current.kind.at <= now) {
					throw new Error("This time has passed. Edit the schedule first.");
				}
				patch = {
					enabled: true,
					nextFireAt: nextFireAfter(current.kind, now),
					lastError: undefined,
				};
			} else {
				patch = { enabled: false, nextFireAt: undefined };
			}
			const updated = await schedulesStore.update(id, patch);
			if (!updated) throw new Error("Schedule not found");
			runner.upsert(updated);
			push();
			return updated;
		},
	);

	ipcMain.handle("schedules:remove", async (_e, id: string) => {
		runner.remove(id);
		await schedulesStore.remove(id);
		push();
	});
}
