import { useEffect } from "react";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useReadStore } from "../stores/useReadStore";

function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role === "assistant") return m.ts;
	}
	return 0;
}

export function useDockUnreadBadge() {
	const sessionsMap = useSessionsStore((s) => s.sessions);
	const sessionsOrder = useSessionsStore((s) => s.order);
	const lastReadAt = useReadStore((s) => s.lastReadAt);

	const unreadCount = sessionsOrder.reduce((acc, id) => {
		const sess = sessionsMap[id];
		if (!sess) return acc;
		// Archived sessions are quieted everywhere: AppNav stats, the
		// inbox, and the dock badge. The backend marks-read on archive
		// so this is usually a no-op, but the filter defends against
		// late assistant messages that arrive from a still-winding-down
		// SDK loop after the archive lands.
		if (sess.archivedAt != null) return acc;
		if (sess.status === "running") return acc;
		const lastIncoming = lastIncomingMessageTs(sess);
		if (lastIncoming > 0 && lastIncoming > (lastReadAt[id] ?? 0)) {
			return acc + 1;
		}
		return acc;
	}, 0);

	useEffect(() => {
		window.claude?.setUnreadCount(unreadCount);
	}, [unreadCount]);
}
