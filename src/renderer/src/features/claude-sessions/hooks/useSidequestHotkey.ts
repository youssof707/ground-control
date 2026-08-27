import { useEffect, useRef } from "react";
import { useMatch } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useSidequestsStore } from "../stores/useSidequestsStore";
import { isDraftId } from "../stores/useDraftSessionsStore";
import {
	lastForkableMessageId,
	resolveForkPointMessageId,
} from "../lib/sidequestForkPoint";
import {
	appendQuotedToDraft,
	openSidequestPanelAndFocus,
	recreateSidequest,
} from "../lib/sidequestActions";

/**
 * Global Cmd+S — the sidequest hotkey. Mounted once, in `MainApp`.
 *
 * Decision tree:
 *   1. Selection in the MAIN thread → discard any current sidequest, fork a
 *      new one at that message, paste the quoted selection, focus.
 *   2. Selection INSIDE the sidequest panel → no fork, no discard; just paste
 *      the quoted selection into the composer and focus.
 *   3. No usable selection → focus the composer. If no sidequest exists yet,
 *      first fork one at the last visible Claude message.
 *
 * Registered in the capture phase so nothing swallows it first, and — unlike
 * the dictation handler in ImagePasteTextarea — it deliberately does NOT skip
 * editable targets: a DOM selection in the transcript coexists with focus
 * sitting in the composer, which is the common case.
 *
 * Note: a selection inside a `<textarea>` is control-internal, so
 * `window.getSelection().toString()` returns "" in Chromium. Highlighting text
 * in a composer and hitting Cmd+S therefore falls through to case 3 (focus
 * only), which is the sane outcome anyway.
 */
export function useSidequestHotkey(): void {
	const match = useMatch("/sessions/:id/*");
	// Kept in a ref so the listener can stay mounted for the app's lifetime
	// instead of being torn down and re-added on every navigation.
	const activeSessionIdRef = useRef<string | undefined>(match?.params.id);
	activeSessionIdRef.current = match?.params.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== "s") return;

			const sessionId = activeSessionIdRef.current;
			// Not on a session route (index, or an unsaved draft session) —
			// there's nothing to fork from. Let the key fall through untouched.
			if (!sessionId || isDraftId(sessionId)) return;
			const session = useSessionsStore.getState().sessions[sessionId];
			if (!session) return;

			// Cmd+S is unbound in both the app menu and the renderer, so from
			// here on it's ours.
			e.preventDefault();
			e.stopPropagation();

			const sel = window.getSelection();
			const selText = sel && !sel.isCollapsed ? sel.toString().trim() : "";
			let startEl: Element | null = null;
			if (selText && sel && sel.rangeCount > 0) {
				const node = sel.getRangeAt(0).startContainer;
				startEl =
					node.nodeType === Node.ELEMENT_NODE
						? (node as Element)
						: node.parentElement;
			}
			// A selection spanning several messages resolves to its *first*
			// message — that's where the user started dragging.
			const inPanel = startEl?.closest("[data-sidequest-panel]") ?? null;
			const msgEl = inPanel
				? null
				: (startEl?.closest("[data-message-id]") ?? null);

			const sq = useSidequestsStore.getState().byParent[sessionId];

			// CASE 2 — selection inside the sidequest itself: quote it back into
			// the same conversation. Never re-forks, never discards.
			if (selText && inPanel && sq) {
				appendQuotedToDraft(sq.sidequestId, selText);
				openSidequestPanelAndFocus();
				return;
			}

			// CASE 1 — selection in the main thread: (re-)fork at that message.
			if (selText && msgEl) {
				const containingId = msgEl.getAttribute("data-message-id");
				const forkMessageId = containingId
					? resolveForkPointMessageId(session.messages ?? [], containingId)
					: null;
				// Nothing forkable yet (parent has never replied) — stay silent
				// rather than opening an empty panel.
				if (!forkMessageId || !session.sdkSessionId) return;
				void (async () => {
					const newId = await recreateSidequest(sessionId, forkMessageId);
					if (newId) appendQuotedToDraft(newId, selText);
					// Open regardless: on failure the panel shows the error.
					openSidequestPanelAndFocus();
				})();
				return;
			}

			// CASE 3 — no usable selection: focus the composer, creating a
			// sidequest at the last Claude message if there isn't one yet.
			if (!sq) {
				const forkMessageId = lastForkableMessageId(session.messages ?? []);
				if (!forkMessageId || !session.sdkSessionId) return;
				void (async () => {
					await recreateSidequest(sessionId, forkMessageId);
					openSidequestPanelAndFocus();
				})();
				return;
			}
			openSidequestPanelAndFocus();
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
