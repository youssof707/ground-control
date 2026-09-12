import { useNavigate } from "react-router-dom";
import type { SessionMode, UserContentBlock } from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { isDraftId, useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useRightPanelStore } from "../stores/useRightPanelStore";
import {
	isSidequestId,
	sidequestByChildId,
	useSidequestsStore,
} from "../stores/useSidequestsStore";
import { draftFromBlocks } from "../lib/composerImages";
import { sendTurn } from "../lib/sendTurn";
import { sendToSidequest } from "../lib/sidequestActions";
import { createSessionFromDraft } from "../lib/promoteDraft";
import { runHandoffDelete } from "../lib/handoffActions";

export type ComposerKind = "session" | "draft" | "sidequest";

export interface ComposerTarget {
	kind: ComposerKind;
	/** True only for a sidequest still being handed to the SDK
	 * (`status === "starting"`) — no live query yet to accept a mode change,
	 * and nothing to send to. Always false for the other two kinds. */
	starting: boolean;
	mode: SessionMode;
	isRunning: boolean;
	/** Session kind only — undefined elsewhere, which reads as "not stale". */
	branch?: string;
	lastUserMessageBranch?: string;
	placeholder: string;
	/** Whether the composer should stamp `data-composer-session-id` — the
	 * handle the global Cmd+K / Cmd+P / Cmd+Shift+M hotkeys use to find "the"
	 * composer via `closest()`. False for sidequests: those hotkeys resolve
	 * ids through `useSessionsStore`/`useDraftSessionsStore` only, so a
	 * stamped sidequest id would mint a phantom sidebar row (`upsertSession`
	 * lazy-creates) or steal focus into the wrong composer. See
	 * `usePlanModeHotkey`'s "deliberately excluded" comment. */
	stampComposerAttr: boolean;
	/** Bumped to (re-)focus this composer with the caret at the end — a
	 * separate counter per kind (`useDraftStore.composerFocusNonce` for
	 * session/draft, `useSidequestsStore.focusNonce` for sidequests) so
	 * focusing one composer never yanks the caret out of the other. */
	focusNonce: number;
	requestFocus: () => void;
	/** Optimistic mode flip with revert-on-failure. Throws on IPC failure
	 * after already reverting the optimistic write — callers decide how (or
	 * whether) to surface the error. */
	changeMode: (next: SessionMode) => Promise<void>;
	/** Owns the whole draft lifecycle for this kind — clearing on success,
	 * restoring on failure (sidequests only, since they clear optimistically
	 * up front), draft→real-session promotion and navigation (draft only).
	 * Throws on failure; the caller only needs `sending`/`error` UI state. */
	send: (blocks: UserContentBlock[]) => Promise<void>;
}

/**
 * Single source of truth for "what kind of thing is this composer talking
 * to, and how does it behave" — session, draft, or sidequest. Used by the
 * shared `MessageComposer` so it has one code path instead of a second,
 * hand-duplicated component per kind.
 *
 * Every store read here is a scalar selector, never a whole-row object:
 * `useSessionsStore.appendMessage` and `useSidequestsStore.appendMessage`
 * both mint a new object on every streamed token, so subscribing to the row
 * itself would re-render the composer (and its text-keyed auto-grow effect)
 * per token instead of per relevant field change.
 */
export function useComposerTarget(sessionId: string): ComposerTarget {
	const isDraft = isDraftId(sessionId);
	const isSq = isSidequestId(sessionId);
	const navigate = useNavigate();

	// ── Draft ────────────────────────────────────────────────────────────────
	const draftMode = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft.mode : undefined,
	);

	// ── Session ──────────────────────────────────────────────────────────────
	const sessMode = useSessionsStore((s) => s.sessions[sessionId]?.mode);
	const sessStatus = useSessionsStore((s) => s.sessions[sessionId]?.status);
	const sessBranch = useSessionsStore((s) => s.sessions[sessionId]?.branch);
	const sessLastUserMessageBranch = useSessionsStore(
		(s) => s.sessions[sessionId]?.lastUserMessageBranch,
	);

	// ── Sidequest ────────────────────────────────────────────────────────────
	// Scalar selectors via the reverse lookup — see the module doc above for
	// why this can't be `s.byParent[x]` (or the sidequest-keyed equivalent).
	const sqMode = useSidequestsStore((s) =>
		sidequestByChildId(s.byParent, sessionId)?.mode,
	);
	const sqStatus = useSidequestsStore((s) =>
		sidequestByChildId(s.byParent, sessionId)?.status,
	);
	const sqParentId = useSidequestsStore((s) =>
		sidequestByChildId(s.byParent, sessionId)?.parentSessionId,
	);

	// ── Focus nonces — both selected unconditionally (hooks rule), only the
	// kind-appropriate one feeds the result. ─────────────────────────────────
	const draftFocusNonce = useDraftStore((s) => s.composerFocusNonce);
	const sqFocusNonce = useSidequestsStore((s) => s.focusNonce);

	const mode: SessionMode = isSq
		? (sqMode ?? "plan")
		: isDraft
			? (draftMode ?? "plan")
			: (sessMode ?? "plan");

	const starting = isSq && sqStatus === "starting";
	const isRunning = isSq ? sqStatus === "running" : sessStatus === "running";

	const changeMode = async (next: SessionMode) => {
		if (isDraft) {
			// Draft sessions don't exist in main yet — no IPC to call. Just
			// update the in-memory draft so the chosen mode flows through to
			// the eventual startSession call in send().
			useDraftSessionsStore.getState().updateDraft({ mode: next });
			return;
		}
		if (isSq) {
			if (!sqParentId) return;
			const previous = sqMode ?? "plan";
			// Optimistic flip; main applies the change to the live SDK query
			// only and answers on `sidequest:patch` — persisting or emitting
			// `session:patch` for an ephemeral id would mint a ghost sidebar
			// row, so revert goes through `patch`, not `upsertSession`.
			useSidequestsStore.getState().patch(sessionId, { mode: next });
			try {
				await window.claude.setSessionMode(sessionId, next);
			} catch (err) {
				useSidequestsStore.getState().patch(sessionId, { mode: previous });
				throw err;
			}
			return;
		}
		// Real session: optimistic flip, revert on IPC failure. Main
		// broadcasts the canonical value back via session:patch on success.
		const previous = sessMode ?? "plan";
		useSessionsStore.getState().upsertSession({ id: sessionId, mode: next });
		try {
			await window.claude.setSessionMode(sessionId, next);
		} catch (err) {
			useSessionsStore
				.getState()
				.upsertSession({ id: sessionId, mode: previous });
			throw err;
		}
	};

	const send = async (blocks: UserContentBlock[]) => {
		if (isSq) {
			if (!sqParentId) throw new Error("Sidequest no longer exists");
			// Clear optimistically before the IPC — the turn comes back to the
			// transcript via the `sidequest:message` broadcast main fires from
			// `pushUserMessage`, not a local echo (sidequests never get one).
			useDraftStore.getState().clearDraft(sessionId);
			try {
				// Heals a dead sidequest rather than failing: an errored SDK loop
				// is unrecoverable and would otherwise force the user through
				// Clear, which used to take their message with it. Returns the id
				// the turn actually landed in — a fresh one if it had to re-fork.
				const landedIn = await sendToSidequest(sqParentId, sessionId, blocks);
				if (!landedIn) {
					throw new Error("Couldn't start a sidequest to send to");
				}
			} catch (err) {
				// Put the whole draft back so nothing is lost — losing a multi-MB
				// pasted screenshot to a transient IPC failure is not
				// recoverable. Restored under the *current* sidequest id:
				// `sendToSidequest` may have re-forked mid-flight, so the id that
				// started this call may no longer be the live one under this
				// parent.
				const current =
					useSidequestsStore.getState().byParent[sqParentId]?.sidequestId
					?? sessionId;
				const restored = draftFromBlocks(blocks);
				useDraftStore.getState().setDraftImages(current, restored.images);
				useDraftStore.getState().setDraftText(current, restored.text);
				throw err;
			}
			return;
		}

		// Explicit annotation: `isDraftId`/`isSidequestId` are both typed as
		// `id is string` (same type as the parameter, since there's no
		// branded id type), which trips TS's aliased-condition narrowing —
		// having already returned out of the `isSq` branch above, TS narrows
		// `sessionId` itself to `never` here. It's still a plain string at
		// runtime; the annotation just stops that from infecting `targetId`.
		let targetId: string = sessionId;
		// Deferred half of "Handoff & delete" — captured before discardDraft()
		// below nulls the slot. Only fired once the promotion AND the first
		// turn have both succeeded, so an abandoned or failed handoff never
		// destroys the source.
		let handoffDeleteId: string | undefined;
		if (isDraft) {
			// Promote the draft to a real session before delivering the
			// message. createSessionFromDraft subscribes to session:started
			// BEFORE invoking startSession so we don't miss the broadcast;
			// useSessionsBootstrap also handles it and upserts the full
			// ClaudeSession into useSessionsStore, so by the time this
			// resolves sendTurn's appendMessage call has a valid row.
			const draft = useDraftSessionsStore.getState().draft;
			if (!draft || draft.id !== sessionId) {
				throw new Error("Draft session no longer exists");
			}
			handoffDeleteId = draft.handoffDeleteSessionId;
			targetId = await createSessionFromDraft(draft);
		}
		// sendTurn owns the resume-if-needed check, the sendUserMessage IPC
		// call, and the optimistic local echo — shared with
		// useQueuedMessageFlusher so a manually-sent turn and a flushed
		// pre-move go through identical logic.
		await sendTurn(targetId, blocks);
		useDraftStore.getState().clearDraft(sessionId);
		if (isDraft) {
			// Navigate BEFORE discardDraft so the DraftSessionChat doesn't
			// briefly render its "Draft no longer exists" fallback. The route
			// swap unmounts the draft view and mounts the real SessionChat for
			// `targetId`. `replace` so the back button doesn't strand the user
			// on the now-dead draft URL.
			//
			// Carry the right panel across with it: it's keyed by session id,
			// so a Notes/Sidequest panel opened on the draft would otherwise
			// silently vanish the moment the id changes. Same re-keying pattern
			// as `moveDraft` / `moveSession` on a sidequest re-fork.
			useRightPanelStore.getState().moveSession(sessionId, targetId);
			navigate(`/sessions/${targetId}`, { replace: true });
			useDraftSessionsStore.getState().discardDraft();
			// Only now — successor exists (born with the source's groupId, so
			// pruneGroupIfEmpty always finds a member) and has actually
			// received the handoff turn. Fire-and-forget: runHandoffDelete
			// routes through the background-task store so a failure surfaces
			// there instead of on this (possibly already-unmounted) composer.
			if (handoffDeleteId && handoffDeleteId !== targetId) {
				runHandoffDelete(handoffDeleteId);
			}
		}
	};

	return {
		kind: isSq ? "sidequest" : isDraft ? "draft" : "session",
		starting,
		mode,
		isRunning,
		branch: isSq || isDraft ? undefined : sessBranch,
		lastUserMessageBranch: isSq || isDraft ? undefined : sessLastUserMessageBranch,
		placeholder: isSq ? "Ask a quick question…" : "Reply to Claude…",
		stampComposerAttr: !isSq,
		focusNonce: isSq ? sqFocusNonce : draftFocusNonce,
		requestFocus: () => {
			if (isSq) useSidequestsStore.getState().bumpFocus();
			else useDraftStore.getState().bumpComposerFocus();
		},
		changeMode,
		send,
	};
}
