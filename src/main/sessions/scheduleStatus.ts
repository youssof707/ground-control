import * as schedulesStore from "../core/store/schedules";
import { broadcast } from "../windows";
import type { ScheduleReport } from "./scheduleReportTool";
import type {
	Schedule,
	ScheduleStatusColor,
} from "../../shared/schemas/schedules";
import { playChime } from "./chime";

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

const alwaysShowPatch = (scheduleId: string, nextColor: ScheduleReport["color"]) =>
	nextColor !== "green" &&
	schedulesStore.get(scheduleId)?.status?.color === "green"
		? { alwaysShowStatus: true }
		: {};

function shouldChime(
	before: Schedule | undefined,
	color: ScheduleStatusColor,
	sessionId: string,
): boolean {
	if (!before) return false;
	const wanted =
		color === "yellow"
			? before.chimeOnYellow
			: color === "red"
				? before.chimeOnRed
				: false;
	if (!wanted) return false;
	const prev = before.status;
	return !prev || prev.color !== color || prev.sessionId !== sessionId;
}

export async function report(r: ScheduleReport): Promise<void> {
	const before = schedulesStore.get(r.scheduleId);
	const updated = await schedulesStore.update(r.scheduleId, {
		...alwaysShowPatch(r.scheduleId, r.color),
		status: { color: r.color, line: r.line, at: Date.now(), sessionId: r.sessionId },
	});
	if (!updated) return;
	if (shouldChime(before, r.color, r.sessionId)) playChime();
	push();
}

export async function settle(
	scheduleId: string,
	sessionId: string,
	outcome: ScheduledRunOutcome,
): Promise<void> {
	const current = schedulesStore.get(scheduleId);
	if (!current || current.status?.sessionId === sessionId) return;
	const settled = SETTLED_STATUS[outcome];
	const updated = await schedulesStore.update(scheduleId, {
		...alwaysShowPatch(scheduleId, settled.color),
		status: { ...settled, at: Date.now(), sessionId },
	});
	if (!updated) return;
	if (shouldChime(current, settled.color, sessionId)) playChime();
	push();
}

export async function clearStatus(scheduleId: string): Promise<void> {
	const current = schedulesStore.get(scheduleId);
	if (!current?.status) return;
	await schedulesStore.update(scheduleId, {
		status: undefined,
	});
	push();
}
