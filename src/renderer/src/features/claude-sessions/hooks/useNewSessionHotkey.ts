import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { startNewSessionDraft } from "../lib/sessionStartActions";
import { useSettingsStore } from "../stores/useSettingsStore";

export function useNewSessionHotkey(): void {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "t") return;

			e.preventDefault();
			e.stopPropagation();

			const targetCwd =
				useSettingsStore.getState().lastUsedWorkspace ?? null;
			void startNewSessionDraft(navigateRef.current, { targetCwd });
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
