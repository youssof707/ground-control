import type { Schedule } from "@shared/schemas/schedules";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";

export function scheduleSessionTarget(
	schedule: Schedule,
	sessions: Record<string, ClaudeSessionFull | undefined>,
): string | undefined {
	return [schedule.lastSessionId, schedule.status?.sessionId].find(
		(id): id is string => !!id && !!sessions[id],
	);
}
