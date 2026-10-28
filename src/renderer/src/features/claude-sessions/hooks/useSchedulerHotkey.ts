import { useEffect } from "react";
import { useSchedulerModalStore } from "../stores/useSchedulerModalStore";

export function useSchedulerHotkey() {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return;
			if (e.key.toLowerCase() !== "s") return;
			e.preventDefault();
			e.stopPropagation();
			useSchedulerModalStore.getState().open("schedules");
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);
}
