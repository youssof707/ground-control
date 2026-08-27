import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
	isSidequestId,
	useSidequestsStore,
} from "../stores/useSidequestsStore";
import { useRightPanelStore } from "../stores/useRightPanelStore";

interface PermissionClickIntent {
	type: "permission";
	requestId: string;
	sessionId: string;
}

type NotificationClickIntent = PermissionClickIntent;

export function useNotificationRouter() {
	const navigate = useNavigate();

	useEffect(() => {
		if (!window.claude) return;
		return window.claude.on("notification:clicked", (payload) => {
			const intent = payload as NotificationClickIntent;
			if (intent.type !== "permission") return;
			// A sidequest has no route of its own — navigate to its parent
			// session and open the panel where its permission card lives.
			// Never navigate to `/sessions/sidequest-…`: there's no row there,
			// so the chat would render as a dead end.
			if (isSidequestId(intent.sessionId)) {
				const parentId = useSidequestsStore
					.getState()
					.parentOf(intent.sessionId);
				if (!parentId) return;
				navigate(`/sessions/${parentId}`);
				useRightPanelStore.getState().setRightPanel("sidequest");
				return;
			}
			navigate(`/sessions/${intent.sessionId}`);
		});
	}, [navigate]);
}
