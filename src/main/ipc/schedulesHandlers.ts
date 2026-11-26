import { ipcMain } from "electron";
import * as schedulesStore from "../core/store/schedules";
import {
	nextFireAfter,
	type CreateScheduleInput,
	type UpdateScheduleInput,
} from "../../shared/schemas/schedules";
import type { ScheduleRunner } from "../sessions/ScheduleRunner";
import { clearStatus } from "../sessions/scheduleStatus";
import {
	createSchedule,
	pushSchedules as push,
	updateSchedule,
} from "../sessions/scheduleMutations";

export function registerSchedulesHandlers(runner: ScheduleRunner): void {
	ipcMain.handle("schedules:list", () => schedulesStore.list());

	ipcMain.handle("schedules:create", (_e, raw: CreateScheduleInput) =>
		createSchedule(runner, raw),
	);

	ipcMain.handle("schedules:update", (_e, raw: UpdateScheduleInput) =>
		updateSchedule(runner, raw),
	);

	ipcMain.handle(
		"schedules:setEnabled",
		async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
			const current = schedulesStore.get(id);
			if (!current) throw new Error("Task not found");
			const now = Date.now();
			let patch: Parameters<typeof schedulesStore.update>[1];
			if (enabled) {
				if (current.kind.type === "once" && current.kind.at <= now) {
					throw new Error("This time has passed. Edit the task first.");
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
			if (!updated) throw new Error("Task not found");
			runner.upsert(updated);
			push();
			return updated;
		},
	);

	ipcMain.handle(
		"schedules:setAlwaysShowStatus",
		async (
			_e,
			{ id, alwaysShowStatus }: { id: string; alwaysShowStatus: boolean },
		) => {
			const updated = await schedulesStore.update(id, {
				alwaysShowStatus: alwaysShowStatus === true,
			});
			if (!updated) throw new Error("Task not found");
			runner.upsert(updated);
			push();
			return updated;
		},
	);

	ipcMain.handle("schedules:runNow", async (_e, id: string) => {
		const session = await runner.runNow(id);
		return session.id;
	});

	ipcMain.handle("schedules:clearStatus", (_e, id: string) =>
		clearStatus(id),
	);

	ipcMain.handle("schedules:remove", async (_e, id: string) => {
		runner.remove(id);
		await schedulesStore.remove(id);
		push();
	});
}
