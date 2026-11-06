import type { Schedule } from "@shared/schemas/schedules";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { useSchedulesStore } from "../stores/useSchedulesStore";

export function dismissScheduleAlert(schedule: Schedule): void {
	useSchedulesStore.getState().upsert({ ...schedule, alert: undefined });
	void window.claude.clearScheduleAlert(schedule.id);
}

export function scheduleSessionTarget(
	schedule: Schedule,
	sessions: Record<string, ClaudeSessionFull | undefined>,
	preferredSessionId?: string,
): string | undefined {
	return [
		preferredSessionId,
		schedule.lastSessionId,
		schedule.status?.sessionId,
	].find((id): id is string => !!id && !!sessions[id]);
}

export function sortedScheduleAlerts(
	schedules: Record<string, Schedule>,
): Schedule[] {
	return Object.values(schedules)
		.filter((s) => s.alert !== undefined)
		.sort((a, b) => (b.alert?.at ?? 0) - (a.alert?.at ?? 0));
}
