import { useMemo } from "react";
import { useSessionsStore } from "../stores/useSessionsStore";

export function workspaceLabel(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

export function useWorkspaces(): string[] {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	return useMemo(() => {
		const set = new Set<string>();
		for (const id of order) {
			const cwd = sessions[id]?.cwd;
			if (cwd) set.add(cwd);
		}
		return Array.from(set).sort((a, b) =>
			workspaceLabel(a).localeCompare(workspaceLabel(b)),
		);
	}, [order, sessions]);
}
