import { useMemo } from "react";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useReadStore } from "../stores/useReadStore";
import { isScheduledSession } from "../lib/scheduledSessions";
import { isSessionUnread } from "../lib/unread";

export function useScheduledUnreadIds(): string[] {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const lastReadAt = useReadStore((s) => s.lastReadAt);
	return useMemo(
		() =>
			order.filter((id) => {
				const s = sessions[id];
				return (
					!!s && isScheduledSession(s) && isSessionUnread(s, lastReadAt[id] ?? 0)
				);
			}),
		[order, sessions, lastReadAt],
	);
}
