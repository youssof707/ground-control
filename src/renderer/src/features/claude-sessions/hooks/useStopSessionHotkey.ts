import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { stopSession, stopSidequest } from "../lib/sessionControlActions";
import { isDraftId } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useSidequestsStore } from "../stores/useSidequestsStore";
import { useTerminalsStore } from "../stores/useTerminalsStore";

function isFocusInSidequestPanel(): boolean {
	const focused = document.activeElement as HTMLElement | null;
	return !!focused?.closest("[data-sidequest-panel]");
}

function stopFocusedTurn(sessionId: string): boolean {
	if (isFocusInSidequestPanel()) {
		const sidequest = useSidequestsStore.getState().byParent[sessionId];
		if (sidequest?.status !== "running") return false;
		void stopSidequest(sidequest.sidequestId);
		return true;
	}
	if (isDraftId(sessionId)) return false;
	const status = useSessionsStore.getState().sessions[sessionId]?.status;
	if (status !== "running" && status !== "awaiting_permission") return false;
	void stopSession(sessionId);
	return true;
}

export function useStopSessionHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "c") return;
			if (useTerminalsStore.getState().openGroupId) return;

			const sessionId = activeSessionIdRef.current;
			if (!sessionId) return;
			if (!stopFocusedTurn(sessionId)) return;

			e.preventDefault();
			e.stopPropagation();
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
