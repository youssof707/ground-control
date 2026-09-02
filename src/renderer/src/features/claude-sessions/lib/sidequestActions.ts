import type { UserContentBlock } from "@shared/schemas/claude_session";
import { lastForkableMessageId } from "./sidequestForkPoint";
import { useDraftStore } from "../stores/useDraftStore";
import { useRightPanelStore } from "../stores/useRightPanelStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import {
	newSidequestId,
	useSidequestsStore,
} from "../stores/useSidequestsStore";

/**
 * Imperative sidequest operations, shared by the global Cmd+S handler and the
 * panel's Clear button. Deliberately store-only (no hooks) so they can run
 * from a window keydown listener outside React's render cycle.
 */

/** Wrap a selection for pasting into the composer: quoted, then a newline. */
export function quoteSelection(text: string): string {
	return `"${text.trim()}"\n`;
}

/**
 * Paste a quoted selection into a sidequest's composer draft.
 *
 * Appends rather than replaces: the user may already have typed a question
 * before selecting more evidence, and clobbering that would be hostile. A
 * freshly forked sidequest has an empty draft anyway — drafts are keyed by
 * sidequest id, so a new fork starts blank.
 */
export function appendQuotedToDraft(sidequestId: string, text: string): void {
	const { draftsBySession, setDraftText } = useDraftStore.getState();
	const existing = draftsBySession[sidequestId]?.text ?? "";
	const next = existing
		? `${existing.replace(/\n*$/, "\n")}${quoteSelection(text)}`
		: quoteSelection(text);
	setDraftText(sidequestId, next);
}

/** Open the sidequest panel and ask its composer to focus (caret at end). */
export function openSidequestPanelAndFocus(): void {
	useRightPanelStore.getState().setRightPanel("sidequest");
	useSidequestsStore.getState().bumpFocus();
}

/**
 * Discard any existing sidequest for `parentSessionId` and fork a fresh one at
 * `forkMessageId`. Returns the new sidequest id, or null if the fork failed.
 *
 * The id is minted here and registered in the store *before* the IPC call, so
 * the panel can render a "starting" state immediately and the caller can seed
 * the draft without waiting for a round trip.
 */
export async function recreateSidequest(
	parentSessionId: string,
	forkMessageId: string,
	opts?: { preserveDraft?: boolean },
): Promise<string | null> {
	const store = useSidequestsStore.getState();
	const existing = store.byParent[parentSessionId];
	const carriedFrom =
		opts?.preserveDraft && existing ? existing.sidequestId : null;
	if (existing) {
		// Drop the old draft with the old session — its id is about to become
		// meaningless, and leaving it would leak one entry per re-fork. Unless
		// the caller is replacing the sidequest *underneath* someone who is
		// mid-compose (Clear, or send-time recovery), in which case the draft
		// is moved onto the new id below instead of being destroyed.
		if (!carriedFrom) useDraftStore.getState().clearDraft(existing.sidequestId);
		try {
			await window.claude.discardSidequest(parentSessionId);
		} catch (err) {
			console.error("[ccw] discardSidequest failed:", err);
		}
		// Main broadcasts `sidequest:discarded`, but that round trip may land
		// after `register` below and would then wipe the new entry.
		store.discard(parentSessionId);
	}

	const sidequestId = newSidequestId();
	if (carriedFrom) useDraftStore.getState().moveDraft(carriedFrom, sidequestId);
	// Mirror what `SessionManager.startSidequest` copies off the parent, so the
	// composer's mode toggle and model label are already correct during the
	// "starting" window. `sidequest:started` re-asserts the same values.
	const parent = useSessionsStore.getState().sessions[parentSessionId];
	useSidequestsStore.getState().register({
		sidequestId,
		parentSessionId,
		forkMessageId,
		mode: parent?.mode ?? "plan",
		model: parent?.model,
	});
	try {
		await window.claude.startSidequest({
			sidequestId,
			parentSessionId,
			forkMessageId,
		});
		return sidequestId;
	} catch (err) {
		// Surfaced inline in the panel — e.g. "no SDK session id yet" when the
		// parent has never run, or a transcript that's been cleared from
		// ~/.claude.
		useSidequestsStore
			.getState()
			.setError(
				sidequestId,
				err instanceof Error ? err.message : String(err),
			);
		return null;
	}
}

/**
 * Send a turn to a sidequest, healing a dead one instead of failing.
 *
 * A sidequest whose SDK loop has errored is gone for good: `runLoop`'s `finally`
 * deletes the running entry, so every later `sendUserMessage` throws "No active
 * session". Before this existed, the only way out was Clear — which also wiped
 * whatever the user had typed and pasted, so a background failure they didn't
 * cause cost them their message.
 *
 * A sidequest is a throwaway fork of the main thread, so replacing one is
 * cheap and needs no ceremony: re-fork at the newest reply and deliver the
 * turn there. `blocks` are already in hand, so the recovery path never depends
 * on the draft store having survived.
 *
 * Returns the sidequest id the turn actually landed in, or null if even the
 * fresh sidequest wouldn't take it (caller restores the draft and shows the
 * error). Only one recovery attempt — if a brand-new fork can't accept a
 * message either, something is wrong that retrying won't fix.
 */
export async function sendToSidequest(
	parentSessionId: string,
	sidequestId: string,
	blocks: UserContentBlock[],
): Promise<string | null> {
	const status = useSidequestsStore.getState().byParent[parentSessionId]?.status;
	// Skip the doomed round trip when we already know the loop is dead, but
	// still try first in every other case: `errored` isn't the only way to lose
	// the entry, and a working sidequest must not be torn down speculatively.
	if (status !== "errored") {
		try {
			await window.claude.sendUserMessage({ sessionId: sidequestId, blocks });
			return sidequestId;
		} catch (err) {
			console.warn("[ccw] sidequest send failed, re-forking:", err);
		}
	}

	const parent = useSessionsStore.getState().sessions[parentSessionId];
	const forkMessageId = lastForkableMessageId(parent?.messages ?? []);
	if (!forkMessageId) return null;

	// preserveDraft: the composer cleared its draft optimistically before
	// calling us, but the user may have typed into the box since. Carrying the
	// entry over keeps that, and keeps the *images* the composer is showing.
	const freshId = await recreateSidequest(parentSessionId, forkMessageId, {
		preserveDraft: true,
	});
	if (!freshId) return null;

	try {
		await window.claude.sendUserMessage({ sessionId: freshId, blocks });
		return freshId;
	} catch (err) {
		console.error("[ccw] sidequest send failed after re-fork:", err);
		useSidequestsStore
			.getState()
			.setError(freshId, err instanceof Error ? err.message : String(err));
		return null;
	}
}
