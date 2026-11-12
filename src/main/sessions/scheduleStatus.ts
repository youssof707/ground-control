import * as schedulesStore from "../core/store/schedules";
import { broadcast } from "../windows";
import type { ScheduleReport } from "./scheduleReportTool";

export type ScheduledRunOutcome = "ok" | "failed" | "stopped";

const SETTLED_STATUS: Record<
	ScheduledRunOutcome,
	{ color: "green" | "yellow"; line: string }
> = {
	ok: { color: "green", line: "nothing to report" },
	failed: { color: "yellow", line: "run failed" },
	stopped: { color: "yellow", line: "stopped" },
};

const push = () => broadcast("schedules:changed", schedulesStore.list());

export async function report(r: ScheduleReport): Promise<void> {
	const updated = await schedulesStore.update(r.scheduleId, {
		status: { color: r.color, line: r.line, at: Date.now(), sessionId: r.sessionId },
	});
	if (updated) push();
}

export async function settle(
	scheduleId: string,
	sessionId: string,
	outcome: ScheduledRunOutcome,
): Promise<void> {
	const current = schedulesStore.get(scheduleId);
	if (!current || current.status?.sessionId === sessionId) return;
	const updated = await schedulesStore.update(scheduleId, {
		status: { ...SETTLED_STATUS[outcome], at: Date.now(), sessionId },
	});
	if (updated) push();
}

export async function clearStatus(scheduleId: string): Promise<void> {
	const current = schedulesStore.get(scheduleId);
	if (!current?.status) return;
	await schedulesStore.update(scheduleId, {
		status: undefined,
	});
	push();
}
