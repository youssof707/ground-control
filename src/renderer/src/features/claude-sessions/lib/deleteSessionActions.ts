import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { pushUndo } from "../stores/useUndoStore";

export async function deleteSessionWithUndo(
	sessionId: string,
	worktreeDeleted = false,
): Promise<void> {
	const title =
		useSessionsStore.getState().sessions[sessionId]?.title ?? "session";
	const snapshot = await window.claude.deleteSession(sessionId);
	useSessionsStore.getState().removeSession(sessionId);
	usePermissionsStore.getState().removeBySessionId(sessionId);
	if (snapshot) {
		pushUndo({
			kind: "delete",
			sessionId,
			title,
			snapshot,
			worktreeDeleted,
		});
	}
}
