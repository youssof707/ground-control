import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useUndoStore } from "../stores/useUndoStore";
import { undoMostRecent } from "../lib/undoActions";

export function useUndoHotkey(): void {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "t") return;
			if (useUndoStore.getState().entries.length === 0) return;

			e.preventDefault();
			e.stopPropagation();

			undoMostRecent((to) => navigateRef.current(to));
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
