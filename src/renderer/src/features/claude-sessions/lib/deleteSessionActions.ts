import type { DeletedSessionSnapshot } from "@shared/claude-sessions/undo";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { pushUndo } from "../stores/useUndoStore";

export async function deleteSessionOnMain(
	sessionId: string,
	title: string,
): Promise<DeletedSessionSnapshot | null> {
	const { snapshot, hookRunning } = await window.claude.deleteSession(sessionId);
	if (hookRunning) {
		runBackgroundTask({
			label: `Distilling ${title}`,
			run: () => window.claude.awaitDeleteHook(sessionId),
		});
	}
	return snapshot;
}

export async function deleteSessionWithUndo(
	sessionId: string,
	worktreeDeleted = false,
): Promise<void> {
	const title =
		useSessionsStore.getState().sessions[sessionId]?.title ?? "session";
	const snapshot = await deleteSessionOnMain(sessionId, title);
	useSessionsStore.getState().removeSession(sessionId);
	usePermissionsStore.getState().removeBySessionId(sessionId);
	if (snapshot) {
		pushUndo({
			sessionId,
			title,
			snapshot,
			worktreeDeleted,
		});
	}
}
