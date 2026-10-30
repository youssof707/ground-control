import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useDeleteSessionRequestStore } from "../stores/useDeleteSessionRequestStore";
import { useSessionsStore } from "../stores/useSessionsStore";

function isEditableFocused(): boolean {
	const el = document.activeElement as HTMLElement | null;
	return (
		!!el
		&& (el.isContentEditable
			|| ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
	);
}

export function useDeleteSessionHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key !== "Backspace") return;
			if (e.repeat) return;

			const sessionId = activeSessionIdRef.current;
			if (!sessionId) return;
			if (!useSessionsStore.getState().sessions[sessionId]) return;
			if (isEditableFocused()) return;
			if (document.querySelector('[aria-modal="true"]')) return;

			e.preventDefault();
			e.stopPropagation();

			useDeleteSessionRequestStore.getState().request(sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
