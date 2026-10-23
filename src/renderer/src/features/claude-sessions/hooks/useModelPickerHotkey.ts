import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useModelPickerStore } from "../stores/useModelPickerStore";
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

			useModelPickerStore.getState().open(sessionId);
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
