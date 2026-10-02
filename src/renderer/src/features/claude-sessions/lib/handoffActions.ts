import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { pushUndo } from "../stores/useUndoStore";
import { useDraftStore } from "../stores/useDraftStore";
import type { DraftSession } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";
import { createSessionFromDraft } from "./promoteDraft";
import { sendTurn } from "./sendTurn";

/**
 * Handoff: one click from a message's ⋯ menu replaces the current session
 * with a fresh one seeded from that message. Store-only (no hooks) so it can
 * run from a plain click handler exactly like lib/composerActions.ts.
 *
 * No confirm step, no draft stop-over. Deletes are undoable (⇧⌘Z / Recently
 * deleted), so the undo buffer is the safety net rather than a dialog.
 */

const TITLE_SUFFIX = " (handoff)";

/** Wrap the handed-off text the way the user reads it back: an explicit
 * instruction followed by the quoted message, delimited so it's obviously
 * quoted material rather than something the user typed themselves. */
function buildHandoffPrompt(assistantText: string): string {
	return [
		"Here is the handoff from the previous session, read this and wait:",
		"",
		"---",
		assistantText.trim(),
		"---",
	].join("\n");
}

/** `${title} (handoff)`, budgeted so the suffix survives the 200-char title
 * cap `createSessionFromDraft` applies (see lib/promoteDraft.ts) — without
 * the slice, a long parent title would eat the " (handoff)" tail. */
function handoffTitle(oldTitle: string): string {
	const base = (oldTitle.trim() || "Session").slice(
		0,
		200 - TITLE_SUFFIX.length,
	);
	return `${base.trimEnd()}${TITLE_SUFFIX}`;
}

/**
 * The source session disappears on the click itself. Everything async —
 * creating the successor, sending it the handoff turn, deleting the source
 * on disk — runs in one background task afterwards, so a failure surfaces in
 * the background-task indicator rather than on a component that has already
 * unmounted.
 *
 * Why the local removal is optimistic rather than waiting for main's delete:
 * the on-disk delete has to be ordered AFTER the successor is persisted (the
 * successor is born with the source's groupId; delete first and
 * `pruneGroupIfEmpty` would take the group out from under it). Waiting for
 * that chain before touching the sidebar left the old row visible for a beat
 * after the new one appeared. `removeSession` writes the renderer tombstone,
 * so anything main still broadcasts for the old id while its delete is in
 * flight is dropped instead of resurrecting the row.
 *
 * Deliberately does NOT touch the single-slot draft store, so an unrelated
 * draft the user has sitting around survives a handoff untouched.
 */
export function runHandoff(input: {
	session: ClaudeSessionFull;
	text: string;
	navigate: (to: string) => void;
}): void {
	const { session, text, navigate } = input;
	const oldId = session.id;
	const title = session.title;

	// Same local cleanup a sidebar delete does, plus the two stores it
	// doesn't touch but that would otherwise leak a keyed entry for a session
	// that no longer exists. "/" is where a delete of the open session lands
	// too; the successor takes over the pane the moment it exists.
	useSessionsStore.getState().removeSession(oldId);
	usePermissionsStore.getState().removeBySessionId(oldId);
	useQueuedMessagesStore.getState().clearSession(oldId);
	useDraftStore.getState().clearDraft(oldId);
	navigate("/");

	// Synthetic draft, never written to the draft store —
	// `createSessionFromDraft` is a pure function of these fields, and reusing
	// it keeps handoff on the exact same promotion path (session:started
	// matching, last-used-worktree bookkeeping) every other new session takes.
	const draft: DraftSession = {
		id: `draft-${crypto.randomUUID()}`,
		cwd: session.cwd,
		title: handoffTitle(title),
		defaultTitle: handoffTitle(title),
		mode: session.mode,
		createdAt: Date.now(),
		worktreeId: session.worktreeId,
		// Inherits the source's model, same rule as fork/sidequest/resume —
		// deliberately NOT the app-wide default.
		model: session.model,
		groupId: session.groupId,
	};

	runBackgroundTask({
		label: `Handing off ${title}`,
		run: async () => {
			// Resolves on `session:started`, which main fires only after the
			// successor record is persisted — so from here on the source can
			// be deleted without racing the group prune.
			const newId = await createSessionFromDraft(draft);
			navigate(`/sessions/${newId}`);
			// Send and delete are independent; neither waits on the other.
			// `allSettled` so the undo entry still lands when the delete
			// succeeded but the send didn't — the session really is gone, and
			// the buffer must say so.
			const [deleted, sent] = await Promise.allSettled([
				window.claude.deleteSession(oldId),
				sendTurn(newId, [{ type: "text", text: buildHandoffPrompt(text) }]),
			]);
			// `kind: "handoff"` gives the toast its own wording: the user is
			// looking at a brand-new session, where a bare "Deleted …" would
			// read as an error. No worktree cascade (the successor shares the
			// checkout), so a restore keeps the worktree binding.
			if (deleted.status === "fulfilled" && deleted.value) {
				pushUndo({
					kind: "handoff",
					sessionId: oldId,
					title,
					snapshot: deleted.value,
					worktreeDeleted: false,
				});
			}
			for (const r of [deleted, sent]) {
				if (r.status === "rejected") throw r.reason;
			}
		},
	});
}
