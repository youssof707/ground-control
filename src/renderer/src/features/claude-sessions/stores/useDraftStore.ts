import { create } from "zustand";
import type { PendingImage } from "../lib/pendingImage";

/**
 * Per-session message-input drafts (text + pasted images). Pure in-memory:
 * no localStorage, no persist middleware, no IPC. Lives for the renderer
 * process lifetime so the user can switch sessions without losing what
 * they were about to send.
 *
 * Empty entries are pruned on clear and on setters that leave both fields
 * empty, so the record doesn't accumulate one stale key per session ever
 * opened.
 */
interface Draft {
	text: string;
	images: PendingImage[];
}

interface State {
	draftsBySession: Record<string, Draft>;
	setDraftText: (sessionId: string, text: string) => void;
	setDraftImages: (sessionId: string, images: PendingImage[]) => void;
	clearDraft: (sessionId: string) => void;
	moveDraft: (fromSessionId: string, toSessionId: string) => void;
	// Monotonic counter the main composer watches to (re-)focus itself and
	// place the caret at the end. Bumped by the Cmd+R composer-focus hotkey
	// (see composerActions.focusComposer) — mirrors useSidequestsStore's
	// focusNonce for the sidequest panel.
	composerFocusNonce: number;
	bumpComposerFocus: () => void;
}

function isEmpty(d: Draft | undefined): boolean {
	return !d || (d.text === "" && d.images.length === 0);
}

export const useDraftStore = create<State>((set) => ({
	draftsBySession: {},
	composerFocusNonce: 0,

	setDraftText: (sessionId, text) =>
		set((s) => {
			if (!sessionId) return s;
			const prev = s.draftsBySession[sessionId];
			const next: Draft = { text, images: prev?.images ?? [] };
			if (isEmpty(next)) {
				if (!prev) return s;
				const rest = { ...s.draftsBySession };
				delete rest[sessionId];
				return { draftsBySession: rest };
			}
			return {
				draftsBySession: { ...s.draftsBySession, [sessionId]: next },
			};
		}),

	setDraftImages: (sessionId, images) =>
		set((s) => {
			if (!sessionId) return s;
			const prev = s.draftsBySession[sessionId];
			const next: Draft = { text: prev?.text ?? "", images };
			if (isEmpty(next)) {
				if (!prev) return s;
				const rest = { ...s.draftsBySession };
				delete rest[sessionId];
				return { draftsBySession: rest };
			}
			return {
				draftsBySession: { ...s.draftsBySession, [sessionId]: next },
			};
		}),

	clearDraft: (sessionId) =>
		set((s) => {
			if (!sessionId || !(sessionId in s.draftsBySession)) return s;
			const rest = { ...s.draftsBySession };
			delete rest[sessionId];
			return { draftsBySession: rest };
		}),

	/**
	 * Re-key a draft onto a different session id, text and images together.
	 *
	 * For sidequests, whose id is minted fresh on every re-fork: Clear and the
	 * send-time auto-recovery both replace the sidequest wholesale, and without
	 * this the user's typed text and pasted images would die with the old id.
	 * Overwrites the destination — a freshly forked sidequest is always blank.
	 */
	moveDraft: (fromSessionId, toSessionId) =>
		set((s) => {
			if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
				return s;
			}
			const draft = s.draftsBySession[fromSessionId];
			const rest = { ...s.draftsBySession };
			delete rest[fromSessionId];
			// Nothing worth carrying: still clear the destination so a stale
			// draft can't reappear under the new id.
			if (isEmpty(draft)) {
				delete rest[toSessionId];
				return { draftsBySession: rest };
			}
			return { draftsBySession: { ...rest, [toSessionId]: draft } };
		}),

	bumpComposerFocus: () =>
		set((s) => ({ composerFocusNonce: s.composerFocusNonce + 1 })),
}));
