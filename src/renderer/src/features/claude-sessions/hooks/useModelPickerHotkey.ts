import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useModelPickerStore } from "../stores/useModelPickerStore";
import { useSidequestsStore } from "../stores/useSidequestsStore";
import { refreshModelOptions } from "../lib/modelOptionsCache";

export function useModelPickerHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		void refreshModelOptions();
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "m") return;

			const sessionId = activeSessionIdRef.current;
			if (!sessionId) return;

			e.preventDefault();
			e.stopPropagation();

			const focused = document.activeElement as HTMLElement | null;
			const sidequestId = focused?.closest("[data-sidequest-panel]")
				? useSidequestsStore.getState().byParent[sessionId]?.sidequestId
				: undefined;

			useModelPickerStore.getState().open(sidequestId ?? sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
