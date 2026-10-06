import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { pushUndo } from "../stores/useUndoStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";

/**
 * Fork and delete: one click from a message's ⋯ menu replaces the current
 * session with a fork branched at that message. Store-only (no hooks) so it
 * runs from a plain click handler, exactly like lib/handoffActions.ts.
 *
 * No confirm step — deletes are undoable (⇧⌘Z / Recently deleted), so the
 * undo buffer is the safety net rather than a dialog.
 *
 * Unlike `runHandoff` this does NOT remove the source optimistically. Fork
 * can fail for real reasons (no SDK session id yet, transcript not flushed,
 * transcript gone from ~/.claude) and main reports those as readable errors;
 * forking first means a failure leaves everything exactly as it was. Main
 * persists the fork, attaches its worktree and broadcasts `session:started`
 * before `forkSession` resolves, so deleting the source afterwards can't
 * prune the group out from under the fork or orphan the worktree binding —
 * the fork already holds both. No worktree cascade for the same reason: the
 * fork shares the checkout.
 */
export function runForkAndDelete(input: {
	/** The session being replaced — in the sidequest panel, the parent. */
	session: ClaudeSessionFull;
	messageId: string;
	navigate: (to: string) => void;
	/** How to produce the fork. Defaults to a plain session fork; the
	 * sidequest panel passes `window.claude.promoteSidequest`, which shares
	 * the signature and goes through the same persist-before-resolve
	 * `forkFrom` in main, so every ordering guarantee above still holds.
	 * Deleting the parent afterwards discards the sidequest — safe, since
	 * promotion marks the run so its transcript survives the discard. */
	fork?: (sessionId: string, messageId: string) => Promise<{ id: string }>;
}): void {
	const { session, messageId, navigate } = input;
	const fork = input.fork ?? window.claude.forkSession;
	const oldId = session.id;
	const title = session.title;

	runBackgroundTask({
		label: `Forking ${title}`,
		run: async () => {
			const next = await fork(oldId, messageId);

			// The fork is on disk and in the sidebar. Now the source goes:
			// local removal first so its row vanishes with the navigation
			// rather than a beat after (same cleanup set as runHandoff).
			useSessionsStore.getState().removeSession(oldId);
			usePermissionsStore.getState().removeBySessionId(oldId);
			useQueuedMessagesStore.getState().clearSession(oldId);
			useDraftStore.getState().clearDraft(oldId);
			navigate(`/sessions/${next.id}`);

			const snapshot = await window.claude.deleteSession(oldId);
			if (snapshot) {
				pushUndo({
					kind: "fork",
					sessionId: oldId,
					title,
					snapshot,
					worktreeDeleted: false,
				});
			}
		},
	});
}
