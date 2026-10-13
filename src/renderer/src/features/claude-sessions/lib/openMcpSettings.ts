import { useSessionsStore } from "../stores/useSessionsStore";
import { currentDraft, isDraftId } from "../stores/useDraftSessionsStore";
import {
	isSidequestId,
	sidequestByChildId,
	useSidequestsStore,
} from "../stores/useSidequestsStore";
import { useSettingsModalStore } from "../stores/useSettingsModalStore";

export function isMcpCommand(text: string): boolean {
	return text.trim() === "/mcp";
}

function composerWorkspace(sessionId: string): string | null {
	if (isDraftId(sessionId)) return currentDraft(sessionId)?.cwd ?? null;
	const sessions = useSessionsStore.getState().sessions;
	if (isSidequestId(sessionId)) {
		const parentId = sidequestByChildId(
			useSidequestsStore.getState().byParent,
			sessionId,
		)?.parentSessionId;
		return parentId ? (sessions[parentId]?.cwd ?? null) : null;
	}
	return sessions[sessionId]?.cwd ?? null;
}

export function openMcpSettingsFor(sessionId: string): void {
	useSettingsModalStore.getState().open("mcp", composerWorkspace(sessionId));
}
