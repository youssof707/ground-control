import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
	isSidequestId,
	useSidequestsStore,
} from "../stores/useSidequestsStore";
import { useRightPanelStore } from "../stores/useRightPanelStore";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import {
	dismissScheduleAlert,
	scheduleSessionTarget,
} from "../lib/scheduleAlerts";

interface PermissionClickIntent {
	type: "permission";
	requestId: string;
	sessionId: string;
}

interface ScheduleAlertClickIntent {
	type: "scheduleAlert";
	scheduleId: string;
	sessionId: string;
}

type NotificationClickIntent = PermissionClickIntent | ScheduleAlertClickIntent;

export function useNotificationRouter() {
	const navigate = useNavigate();

	useEffect(() => {
		if (!window.claude) return;
		return window.claude.on("notification:clicked", (payload) => {
			const intent = payload as NotificationClickIntent;
			if (intent.type === "scheduleAlert") {
				const schedule = useSchedulesStore.getState().byId[intent.scheduleId];
				if (!schedule) return;
				const target = scheduleSessionTarget(
					schedule,
					useSessionsStore.getState().sessions,
					intent.sessionId,
				);
				if (schedule.alert) dismissScheduleAlert(schedule);
				if (target) navigate(`/sessions/${target}`);
				return;
			}
			if (intent.type !== "permission") return;
			// A sidequest has no route of its own — navigate to its parent
			// session and open the panel where its permission card lives.
			// Never navigate to `/sessions/sidequest-…`: there's no row there,
			// so the chat would render as a dead end.
			//
			// The panel write is keyed by parent id, so it doesn't care whether
			// React has committed the route swap yet — order is irrelevant.
			if (isSidequestId(intent.sessionId)) {
				const parentId = useSidequestsStore
					.getState()
					.parentOf(intent.sessionId);
				if (!parentId) return;
				navigate(`/sessions/${parentId}`);
				useRightPanelStore
					.getState()
					.setSessionPanel(parentId, "sidequest");
				return;
			}
			navigate(`/sessions/${intent.sessionId}`);
		});
	}, [navigate]);
}
