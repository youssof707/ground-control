import { useDraftSessionsStore } from "../claude-sessions/stores/useDraftSessionsStore";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { useWorktreesStore } from "../claude-sessions/stores/useWorktreesStore";

export function useSessionCheckout(sessionId: string | undefined): string | undefined {
	const sessionCwd = useSessionsStore((s) =>
		sessionId ? s.sessions[sessionId]?.cwd : undefined,
	);
	const activeCheckout = useSessionsStore((s) =>
		sessionId ? s.sessions[sessionId]?.activeCheckout : undefined,
	);
	const sessionWorktreeId = useSessionsStore((s) =>
		sessionId ? s.sessions[sessionId]?.worktreeId : undefined,
	);
	const draftCwd = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft.cwd : undefined,
	);
	const draftWorktreeId = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft.worktreeId : undefined,
	);
	const cwd = sessionCwd ?? draftCwd;
	const worktreeId = sessionWorktreeId ?? draftWorktreeId;
	const worktreePath = useWorktreesStore((s) =>
		worktreeId ? s.worktrees[worktreeId]?.worktreePath : undefined,
	);
	if (activeCheckout) return trimSlash(activeCheckout);
	if (!cwd) return undefined;
	if (worktreeId) return worktreePath ? trimSlash(worktreePath) : undefined;
	return trimSlash(cwd);
}

function trimSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
