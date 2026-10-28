import { MINUTES_PER_DAY, type ScheduleKind } from "@shared/schemas/schedules";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function toTimeValue(minuteOfDay: number): string {
	return `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
}

export function fromTimeValue(value: string): number | null {
	const m = /^(\d{2}):(\d{2})/.exec(value);
	if (!m) return null;
	const minute = Number(m[1]) * 60 + Number(m[2]);
	return minute < MINUTES_PER_DAY ? minute : null;
}

function formatMinuteOfDay(minuteOfDay: number): string {
	const d = new Date(0);
	d.setHours(0, 0, 0, 0);
	d.setMinutes(minuteOfDay);
	return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatScheduleKind(
	kind: ScheduleKind,
	now = Date.now(),
): string {
	if (kind.type === "daily") return `Daily at ${formatMinuteOfDay(kind.minuteOfDay)}`;
	if (kind.type === "repeat") {
		if (kind.everyMs % HOUR_MS === 0) {
			const hours = kind.everyMs / HOUR_MS;
			return hours === 1 ? "Every hour" : `Every ${hours} hours`;
		}
		return `Every ${Math.round(kind.everyMs / MINUTE_MS)} min`;
	}
	const withinWeek = Math.abs(kind.at - now) < 6 * DAY_MS;
	const label = new Date(kind.at).toLocaleString(
		[],
		withinWeek
			? { weekday: "short", hour: "numeric", minute: "2-digit" }
			: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
	);
	return `Once · ${label}`;
}

export function formatNextFire(
	nextFireAt: number | undefined,
	now: number,
): string {
	if (nextFireAt === undefined) return "Paused";
	const delta = nextFireAt - now;
	if (delta <= 0) return "due now";
	if (delta < HOUR_MS) {
		return `in ${Math.max(1, Math.round(delta / MINUTE_MS))} min`;
	}
	if (delta < DAY_MS) return `in ${plural(Math.round(delta / HOUR_MS), "hour")}`;
	return `in ${plural(Math.round(delta / DAY_MS), "day")}`;
}

export function toDatetimeLocalValue(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): number | null {
	if (!value) return null;
	const ms = new Date(value).getTime();
	return Number.isNaN(ms) ? null : ms;
}
