import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import type { DeletedSessionSnapshot } from "@shared/claude-sessions/undo";
import { pushUndo } from "../stores/useUndoStore";
import { useDraftStore } from "../stores/useDraftStore";
import {
	useDraftSessionsStore,
	type DraftSession,
} from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";
import { createSessionFromDraft } from "./promoteDraft";
import { sendTurn } from "./sendTurn";

/**
 * Imperative "Handoff" operations, store-only (no hooks) so they can run from
 * a plain click handler exactly like lib/composerActions.ts. Handoff hands a
 * session's context to a fresh successor that inherits the source session's
 * cwd, mode, worktree, model, and sidebar group. Two flavors:
 *
 *   - `startHandoff` — stage only: mint (or retarget) the single-slot draft
 *     with the composer pre-filled, so the user can edit before sending.
 *   - `runInstantHandoff` — "Handoff & delete", one click: create the
 *     successor, send the handoff turn, and delete the source immediately.
 *     No confirmation gate beyond the modal button — deletes are undoable
 *     (⇧⌘Z / Recently deleted), so the undo buffer is the safety net.
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
 * cap `createSessionFromDraft` applies on send (see lib/promoteDraft.ts) —
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
 * inheriting the source session's cwd/mode/worktree/model/group, and
 * pre-fill the composer with the handoff text — nothing is sent until the
 * user presses Enter.
 *
 * Returns the draft id to navigate to.
 */
export function startHandoff(input: {
	session: ClaudeSessionFull;
	text: string;
}): string {
	const { session, text } = input;
	const drafts = useDraftSessionsStore.getState();

	// Every inherited field is listed explicitly, including the ones that
	// resolve to `undefined`. updateDraft is a shallow spread, so an
	// omitted key means "keep whatever the retargeted draft already had" —
	// which would leak a stale worktree, model override, or group from an
	// abandoned earlier intent into this one.
	const patch = {
		cwd: session.cwd,
		title: handoffTitle(session.title),
		mode: session.mode,
		worktreeId: session.worktreeId,
		// A handoff inherits the source session's model, same rule as
		// fork/sidequest/resume — deliberately NOT the app-wide default.
		model: session.model,
		groupId: session.groupId,
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
 * One-click "Handoff & delete": create the successor session, navigate to
 * it, delete the source, and send the handoff turn — no draft stop-over, no
 * Enter press. Fire-and-forget via runBackgroundTask so the caller (a modal
 * button that unmounts on navigation) never owns the error: a failure
 * surfaces in the background-task indicator, and the delete is undoable
 * regardless.
 *
 * Deliberately does NOT touch the single-slot draft store, so an unrelated
 * draft the user has sitting around survives an instant handoff untouched.
 *
 * Ordering matters twice:
 *   - Successor BEFORE delete: the successor is born with the source's
 *     groupId, so `pruneGroupIfEmpty` always finds a member and a
 *     last-member handoff can't auto-delete its group mid-flight.
 *   - Navigate BEFORE delete: the user is looking at the source session
 *     when they click, and the delete tombstones it — navigating first
 *     means they never see a "Session not found" flash.
 */
export function runInstantHandoff(input: {
	session: ClaudeSessionFull;
	text: string;
	navigate: (to: string) => void;
}): void {
	const { session, text, navigate } = input;
	// Synthetic draft, never written to the draft store —
	// `createSessionFromDraft` is a pure function of the fields below, and
	// reusing it keeps instant handoff on the exact same promotion path
	// (session:started matching, last-used-worktree bookkeeping) as a staged
	// one.
	const draft: DraftSession = {
		id: `draft-${crypto.randomUUID()}`,
		cwd: session.cwd,
		title: handoffTitle(session.title),
		defaultTitle: handoffTitle(session.title),
		mode: session.mode,
		createdAt: Date.now(),
		worktreeId: session.worktreeId,
		model: session.model,
		groupId: session.groupId,
	};
	runBackgroundTask({
		label: `Handing off ${session.title}`,
		run: async () => {
			const newId = await createSessionFromDraft(draft);
			navigate(`/sessions/${newId}`);
			runHandoffDelete(session.id);
			await sendTurn(newId, [
				{ type: "text", text: buildHandoffPrompt(text) },
			]);
		},
	});
}

/**
 * The delete half of "Handoff & delete". Called by `runInstantHandoff` the
 * moment the successor session exists — so a failed handoff (successor never
 * created) never destroys the source.
 *
 * Fire-and-forget via runBackgroundTask, the same treatment confirmDelete
 * gives its worktree cascade: the user has already navigated away, so a
 * rejection must not be reported as a handoff failure — it surfaces in the
 * background-tasks indicator instead, and the old session simply stays put
 * if it fails.
 */
export function runHandoffDelete(oldSessionId: string): void {
	const title =
		useSessionsStore.getState().sessions[oldSessionId]?.title ?? "session";
	// Captured out of `run` because runBackgroundTask's onSuccess takes no
	// value. This is the snapshot that makes the delete undoable.
	let snapshot: DeletedSessionSnapshot | null = null;
	runBackgroundTask({
		label: `Deleting ${title}`,
		run: async () => {
			snapshot = await window.claude.deleteSession(oldSessionId);
		},
		onSuccess: () => {
			// Buffer the undo only once the delete has actually landed — NOT
			// when the user clicked "Handoff & delete" — so the buffer never
			// offers to undo something that hasn't happened. `kind: "handoff"`
			// gives the toast its own wording: by now the user is looking at a
			// brand-new session, where a bare "Deleted …" would read as an
			// error.
			//
			// No worktree cascade here (the successor shares the checkout), so
			// `worktreeDeleted` is false and the restored session keeps its
			// worktree binding.
			if (snapshot) {
				pushUndo({
					kind: "handoff",
					sessionId: oldSessionId,
					title,
					snapshot,
					worktreeDeleted: false,
				});
			}
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
