import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { useDraftStore } from "../stores/useDraftStore";
import { useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";

/**
 * Imperative "Handoff" operations, store-only (no hooks) so they can run from
 * a plain click handler exactly like lib/composerActions.ts. Handoff hands a
 * session's context to a fresh successor: a new draft is minted (or the
 * existing single-slot draft is retargeted) with the source session's cwd,
 * mode, worktree, model, and sidebar group, and the composer is pre-filled
 * with the handoff text — never sent automatically.
 */

const TITLE_SUFFIX = " (handoff)";

/** Wrap the handed-off text the way the user reads it back: an explicit
 * instruction followed by the quoted message, delimited so it's obviously
 * quoted material rather than something the user typed themselves. */
export function buildHandoffPrompt(assistantText: string): string {
	return [
		"Here is the handoff from the previous session, read this and wait:",
		"",
		"---",
		assistantText.trim(),
		"---",
	].join("\n");
}

/** `${title} (handoff)`, budgeted so the suffix survives the 200-char title
 * cap `createSessionFromDraft` applies on send (see ImagePasteTextarea.tsx) —
 * without the slice, a long parent title would eat the " (handoff)" tail. */
export function handoffTitle(oldTitle: string): string {
	const base = (oldTitle.trim() || "Session").slice(
		0,
		200 - TITLE_SUFFIX.length,
	);
	return `${base.trimEnd()}${TITLE_SUFFIX}`;
}

/**
 * Stage a handoff: retarget the existing single-slot draft or create one,
 * inheriting the source session's cwd/mode/worktree/model/group, pre-fill
 * the composer with the handoff text, and (for "Handoff & delete") remember
 * which session to delete once the draft is actually promoted and sent.
 *
 * Returns the draft id to navigate to.
 */
export function startHandoff(input: {
	session: ClaudeSessionFull;
	text: string;
	deleteOld: boolean;
}): string {
	const { session, text, deleteOld } = input;
	const drafts = useDraftSessionsStore.getState();

	// Every inherited field is listed explicitly, including the ones that
	// resolve to `undefined`. updateDraft is a shallow spread, so an
	// omitted key means "keep whatever the retargeted draft already had" —
	// which would leak a stale worktree, model override, group, or (worst)
	// a pending handoff-delete from an abandoned earlier handoff into this
	// one.
	const patch = {
		cwd: session.cwd,
		title: handoffTitle(session.title),
		mode: session.mode,
		worktreeId: session.worktreeId,
		// A handoff inherits the source session's model, same rule as
		// fork/sidequest/resume — deliberately NOT the app-wide default.
		model: session.model,
		groupId: session.groupId,
		handoffDeleteSessionId: deleteOld ? session.id : undefined,
	};

	// Same single-slot rule as startFromShortcut: RETARGET an existing draft
	// rather than refusing or creating a second one.
	let id: string;
	if (drafts.draft) {
		drafts.updateDraft(patch);
		id = drafts.draft.id;
	} else {
		const created = drafts.createDraft({
			cwd: session.cwd,
			defaultTitle: `Session ${useSessionsStore.getState().order.length + 1}`,
			mode: session.mode,
			worktreeId: session.worktreeId,
		});
		drafts.updateDraft(patch);
		id = created.id;
	}

	// Overwrites any leftover draft text, deliberately — handing off is an
	// explicit "start this" action, same reasoning as startFromShortcut.
	useDraftStore.getState().setDraftText(id, buildHandoffPrompt(text));
	return id;
}

/**
 * Deferred half of "Handoff & delete". Called only after the successor
 * session has been promoted from its draft AND actually received its first
 * turn — so a failed or abandoned handoff never destroys the source.
 *
 * Fire-and-forget via runBackgroundTask, the same treatment confirmDelete
 * gives its worktree cascade: the caller (ImagePasteTextarea.send) has
 * already navigated away and may unmount before this resolves, so a
 * rejection must not be reported as a send failure — it surfaces in the
 * background-tasks indicator instead, and the old session simply stays put
 * if it fails.
 */
export function runHandoffDelete(oldSessionId: string): void {
	const title =
		useSessionsStore.getState().sessions[oldSessionId]?.title ?? "session";
	runBackgroundTask({
		label: `Deleting ${title}`,
		run: () => window.claude.deleteSession(oldSessionId),
		onSuccess: () => {
			// Same local cleanup confirmDelete does (removeSession also
			// writes the deletedIds tombstone), plus the two stores
			// confirmDelete doesn't touch but that would otherwise leak a
			// keyed entry for a session that no longer exists. Deliberately
			// NOT cascading the worktree — the successor shares that
			// checkout.
			useSessionsStore.getState().removeSession(oldSessionId);
			usePermissionsStore.getState().removeBySessionId(oldSessionId);
			useQueuedMessagesStore.getState().clearSession(oldSessionId);
			useDraftStore.getState().clearDraft(oldSessionId);
		},
	});
}
