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
): Promise<string | null> {
	const store = useSidequestsStore.getState();
	const existing = store.byParent[parentSessionId];
	if (existing) {
		// Drop the old draft with the old session — its id is about to become
		// meaningless, and leaving it would leak one entry per re-fork.
		useDraftStore.getState().clearDraft(existing.sidequestId);
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
