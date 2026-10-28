export function isScheduledSession(
	session: { scheduleId?: string } | undefined,
): boolean {
	return !!session?.scheduleId;
}
