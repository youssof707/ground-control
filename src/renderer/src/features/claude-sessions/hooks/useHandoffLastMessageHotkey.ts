import { useEffect, useRef } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { lastAssistantText } from "../lib/handoffCommand";
import { runHandoff } from "../lib/handoffActions";

export function useHandoffLastMessageHotkey(): void {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;
	const match = useMatch("/sessions/:id/*");
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "h") return;
			if (e.repeat) return;

			const sessionId = activeSessionIdRef.current;
			if (!sessionId) return;
			const session = useSessionsStore.getState().sessions[sessionId];
			if (!session) return;
			if (document.querySelector('[aria-modal="true"]')) return;
			const text = lastAssistantText(session);
			if (!text) return;

			e.preventDefault();
			e.stopPropagation();

			runHandoff({ session, text, navigate: navigateRef.current });
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
