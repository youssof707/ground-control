import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

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
			if (intent.type === "permission") {
				navigate(`/sessions/${intent.sessionId}`);
			}
		});
	}, [navigate]);
}
