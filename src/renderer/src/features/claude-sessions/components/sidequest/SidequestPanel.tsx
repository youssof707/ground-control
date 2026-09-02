import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import type { SessionMode } from "@shared/claude-sessions/types";
import {
	deriveDisplayedModel,
	formatModelName,
} from "@shared/claude-sessions/sessionModel";
import { useSessionsStore } from "../../stores/useSessionsStore";
import { usePermissionsStore } from "../../stores/usePermissionsStore";
import { useDraftStore } from "../../stores/useDraftStore";
import {
	useSidequestsStore,
	type SidequestState,
} from "../../stores/useSidequestsStore";
import { groupMessagesIntoUnits } from "../../lib/groupMessages";
import { lastForkableMessageId } from "../../lib/sidequestForkPoint";
import { buildUserBlocks } from "../../lib/composerImages";
import { useComposerImages } from "../../hooks/useComposerImages";
import {
	openSidequestPanelAndFocus,
	recreateSidequest,
} from "../../lib/sidequestActions";
import { MessageView } from "../MessageView";
import { ActivityChip } from "../ActivityChip";
import { ToolRunGroup } from "../ToolRunGroup";
import { PermissionCard } from "../PermissionCard";
import { ModelPickerModal } from "../ModelPickerModal";
import { DictationButton, type DictationHandle } from "../DictationButton";
import { PendingImageStrip } from "../PendingImageThumb";
import { T } from "../../../../design/tokens";
import { ModeToggle, StatusPill } from "../../../../design/Atoms";

/**
 * The sidequest transcript + composer. Wrapped by `SidequestSidebarShell`,
 * which owns the resize handle and width.
 *
 * A sidequest is an ephemeral fork of the main session — see
 * `useSidequestsStore`. Everything here is driven by `sidequest:*` broadcasts;
 * the panel never writes to the session store.
 *
 * The `data-sidequest-panel` attribute on the root is load-bearing: the global
 * Cmd+S handler uses it to tell "selection inside the sidequest" (quote it
 * back into this conversation) from "selection in the main thread" (re-fork).
 */
export function SidequestPanel({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const sq = useSidequestsStore((s) => s.byParent[sessionId]);
	const focusNonce = useSidequestsStore((s) => s.focusNonce);
	const [clearing, setClearing] = useState(false);
	const [forkingId, setForkingId] = useState<string | null>(null);
	const [forkError, setForkError] = useState<string | null>(null);
	const navigate = useNavigate();

	const units = useMemo(
		() => groupMessagesIntoUnits(sq?.messages ?? []),
		[sq?.messages],
	);

	// Permission prompts raised by the sidequest's own tools. Cards render
	// here rather than in the main chat or the Inbox, which both filter
	// sidequest ids out.
	const pending = usePermissionsStore((s) => s.queue).filter(
		(p) => p.sessionId === sq?.sidequestId,
	);

	// Stick to bottom as the reply streams in, same approach as SessionChat.
	const scrollRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [units.length, pending.length, sq?.status]);

	// Whether the parent has a forkable Claude reply yet — drives both the
	// empty state's Start button and its "waiting" copy. Subscribed (not read
	// via getState) so the empty state flips live when the first reply lands.
	const parentMessages = useSessionsStore(
		(s) => s.sessions[sessionId]?.messages,
	);
	const canStart = useMemo(
		() => !!lastForkableMessageId(parentMessages ?? []),
		[parentMessages],
	);

	/**
	 * Fork a sidequest reply into a real session and go there. Main does the
	 * work (`promoteSidequest`): the new session carries the main thread's
	 * history through the branch point plus the sidequest's turns through this
	 * reply, and is left live so the composer works on arrival.
	 *
	 * `useCallback` is load-bearing — `MessageView` is memoized, and an
	 * unstable `onFork` would re-run rehype-highlight across the whole
	 * transcript on every keystroke in the composer.
	 */
	const fork = useCallback(
		async (messageId: string) => {
			if (forkingId) return;
			setForkingId(messageId);
			setForkError(null);
			try {
				const next = await window.claude.promoteSidequest(
					sessionId,
					messageId,
				);
				// Only on success — a failure has to stay readable in the panel
				// we're still standing in.
				navigate(`/sessions/${next.id}`);
			} catch (err) {
				setForkError(err instanceof Error ? err.message : String(err));
			} finally {
				setForkingId(null);
			}
		},
		[forkingId, sessionId, navigate],
	);

	// Forking mid-stream would silently drop everything that lands after the
	// click, and `promoteSidequest` ends by resuming the new session — a second
	// CLI process in the same worktree while this one is still mid-tool.
	// Withholding `onFork` leaves Copy message reachable (see MessageView).
	const canFork =
		!!sq && sq.status !== "running" && sq.status !== "starting";

	// Serves both the header's Clear button (discard + re-fork) and the empty
	// state's Start button (plain fork) — the underlying action is identical:
	// (re-)fork at the very last Claude reply in the main thread.
	const startFresh = async () => {
		if (clearing) return;
		const parent = useSessionsStore.getState().sessions[sessionId];
		const forkMessageId = lastForkableMessageId(parent?.messages ?? []);
		if (!forkMessageId) return;
		setClearing(true);
		try {
			// Discards (aborting mid-stream if needed) and re-forks at the very
			// last Claude reply in the main thread.
			await recreateSidequest(sessionId, forkMessageId);
			openSidequestPanelAndFocus();
		} finally {
			setClearing(false);
		}
	};

	return (
		<div
			data-sidequest-panel
			style={{
				flex: 1,
				minHeight: 0,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				background: T.win,
			}}
		>
			<header
				style={{
					flexShrink: 0,
					padding: "20px 20px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{/* Row 1: title + actions. Row 2 below: status chip — same
				    title-then-status stacking as SessionChat's header and the
				    sidebar rows, so a sidequest reads like a real session. */}
				<div
					style={{
						display: "flex",
						alignItems: "flex-start",
						justifyContent: "space-between",
						gap: 12,
					}}
				>
					<h1
						style={{
							margin: 0,
							fontSize: 20,
							fontWeight: 600,
							color: T.text,
							letterSpacing: "-0.3px",
						}}
					>
						Sidequest
					</h1>
					<div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
						<button
							type="button"
							onClick={startFresh}
							disabled={clearing || !sq}
							style={{
								padding: "6px 12px",
								borderRadius: 8,
								border: `0.5px solid ${T.border}`,
								background: T.surface,
								color: sq ? T.text : T.textFaint,
								fontSize: 12.5,
								fontWeight: 500,
								cursor: sq && !clearing ? "pointer" : "default",
								fontFamily: T.sans,
							}}
						>
							Clear
						</button>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close sidequest"
							style={{
								flexShrink: 0,
								width: 28,
								height: 28,
								borderRadius: 8,
								border: `0.5px solid ${T.border}`,
								background: T.surface,
								color: T.textDim,
								cursor: "pointer",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
								<path
									d="M3 3l6 6M9 3l-6 6"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
						</button>
					</div>
				</div>
				{sq ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							flexWrap: "wrap",
							gap: 10,
						}}
					>
						{/* Same pair of states the sidebar rows show: a pending
						    permission wins as "waiting for input" (orange), and
						    "starting" renders as running — branching is activity.
						    `sq.status` itself never carries awaiting_permission;
						    main only emits running/idle, so it's derived from the
						    permission queue exactly like everywhere else. */}
						<StatusPill
							status={
								pending.length > 0
									? "awaiting_permission"
									: sq.status === "starting"
										? "running"
										: sq.status
							}
						/>
					</div>
				) : null}
			</header>

			{/* Transcript (with floating chip overlay) — same structure as
			    SessionChat: the scroll area fills a relative wrapper, and the
			    ActivityChip floats over its bottom-right corner. */}
			<div
				style={{
					flex: 1,
					minHeight: 0,
					minWidth: 0,
					position: "relative",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<div
					ref={scrollRef}
					style={{
						flex: 1,
						overflow: "auto",
						minHeight: 0,
						minWidth: 0,
						padding: "0 16px 16px",
					}}
				>
					{!sq ? (
						<div
							style={{
								padding: "20px 8px",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: 12,
							}}
						>
							{canStart ? (
								<button
									type="button"
									onClick={() => void startFresh()}
									disabled={clearing}
									style={{
										padding: "6px 12px",
										borderRadius: 8,
										border: `0.5px solid ${T.border}`,
										background: T.surface,
										color: T.text,
										fontSize: 12.5,
										fontWeight: 500,
										cursor: clearing ? "default" : "pointer",
										fontFamily: T.sans,
									}}
								>
									{clearing ? "Branching…" : "Start sidequest"}
								</button>
							) : null}
							<div
								style={{
									fontSize: 12.5,
									color: T.textMute,
									textAlign: "center",
									lineHeight: 1.6,
								}}
							>
								{canStart ? (
									<>
										Select text in the conversation and press ⌘S to ask about
										it without touching the main thread. Press ⌘S with nothing
										selected to branch from the last reply.
									</>
								) : (
									<>
										Waiting for Claude&rsquo;s first reply — sidequests branch
										from an assistant message.
									</>
								)}
							</div>
						</div>
					) : (
						<>
							{sq.error || forkError ? (
								<div
									style={{
										fontSize: 12,
										color: T.danger,
										background: T.dangerSoft,
										border: `0.5px solid ${T.dangerBorder}`,
										padding: 10,
										borderRadius: 8,
										marginBottom: 12,
									}}
								>
									{sq.error || forkError}
								</div>
							) : null}
							{units.map((u) =>
								u.kind === "toolRun" ? (
									<ToolRunGroup key={u.key} entries={u.entries} />
								) : (
								// `onFork` here means "promote this branch into a
								// real session" — a sidequest is already a fork, so
								// the main chat's meaning doesn't apply. No
								// `onHandoff`: promoting is the better version of it.
									<MessageView
										key={u.message.id}
										m={u.message}
										onFork={canFork ? fork : undefined}
										forkPending={forkingId === u.message.id}
									/>
								),
							)}
							{pending.length > 0 ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 12,
										margin: "12px 0",
									}}
								>
									{pending.map((p) => (
										<PermissionCard key={p.requestId} req={p} />
									))}
								</div>
							) : null}
						</>
					)}
				</div>

				{/* Same working indicator as the main thread — identical chip,
			    identical bottom-right float. "starting" shows it too: branching
			    is activity, and the chip's elapsed clock runs off `createdAt`
			    until the first message lands. Hidden while a permission card is
			    up (the chip nulls itself on `hasPending`), matching SessionChat. */}
				{sq && (sq.status === "running" || sq.status === "starting") ? (
					<div
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							padding: "0 16px 4px",
							display: "flex",
							justifyContent: "flex-end",
							pointerEvents: "none",
						}}
					>
						<div style={{ pointerEvents: "auto" }}>
							<ActivityChip
								session={{
									messages: sq.messages,
									createdAt: sq.createdAt,
									status: sq.status,
								}}
								hasPending={pending.length > 0}
							/>
						</div>
					</div>
				) : null}
			</div>

			{sq ? <SidequestComposer sq={sq} focusNonce={focusNonce} /> : null}
		</div>
	);
}

/**
 * A deliberately minimal composer — not `ImagePasteTextarea`, whose `send()`
 * is entangled with draft-session promotion, `resumeSession`, and optimistic
 * appends into `useSessionsStore`. None of that applies to a sidequest: it's
 * always live (main keeps the SDK loop open), never promotes, and echoes the
 * user's turn back over `sidequest:message`.
 *
 * The draft text lives in `useDraftStore` keyed by the sidequest id, which is
 * how Cmd+S can paste a quoted selection in from outside React.
 *
 * The footer controls (dictation, mode toggle, model picker) *are* the same
 * components the main composer uses — only the send path is bespoke.
 */
function SidequestComposer({
	sq,
	focusNonce,
}: {
	sq: SidequestState;
	focusNonce: number;
}) {
	const sidequestId = sq.sidequestId;
	const running = sq.status === "running";
	// The fork is still being handed to the SDK — there's no live query yet to
	// accept a mode/model change, and nothing to send to.
	const starting = sq.status === "starting";
	const text = useDraftStore((s) => s.draftsBySession[sidequestId]?.text ?? "");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const dictationRef = useRef<DictationHandle>(null);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [dictating, setDictating] = useState(false);
	const [modeSwitching, setModeSwitching] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [modelHover, setModelHover] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	// Paste-to-attach, the same hook (and therefore the same draft-store
	// backing) the main composer uses — keyed by the sidequest id.
	const { images, onPaste, removeImage } = useComposerImages(
		sidequestId,
		setError,
	);
	// Images alone are a valid message: a screenshot with no question is the
	// most common sidequest paste.
	const canSend = !!text.trim() || images.length > 0;

	// Same stream-derived label the main chat's token bar shows: the model
	// *actually* answering, not just the requested override, so a CLI-side
	// fallback is visible here too. A sidequest has no store row, so the three
	// fields come off the in-memory sidequest state instead.
	const displayed = useMemo(
		() =>
			deriveDisplayedModel({
				messages: sq.messages,
				model: sq.model,
				modelChangedAt: sq.modelChangedAt,
			}),
		[sq.messages, sq.model, sq.modelChangedAt],
	);

	/**
	 * Flip the sidequest's permission mode. Mirrors `ImagePasteTextarea`'s
	 * `changeMode`, but reconciles against `useSidequestsStore` rather than
	 * `useSessionsStore` — main applies the change to the live SDK query and
	 * answers on `sidequest:patch`, because persisting or emitting
	 * `session:patch` for an ephemeral id would mint a ghost sidebar row.
	 */
	const changeMode = async (next: SessionMode) => {
		if (modeSwitching || starting || sq.mode === next) return;
		const previous = sq.mode;
		useSidequestsStore.getState().patch(sidequestId, { mode: next });
		setModeSwitching(true);
		try {
			await window.claude.setSessionMode(sidequestId, next);
		} catch (err) {
			useSidequestsStore.getState().patch(sidequestId, { mode: previous });
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setModeSwitching(false);
		}
	};

	// Insert dictated text at the caret (replacing any selection), adding a
	// leading space when gluing onto existing non-whitespace. Same shape as
	// `ImagePasteTextarea.insertDictation`.
	const insertDictation = (t: string) => {
		const ta = textareaRef.current;
		const start = ta?.selectionStart ?? text.length;
		const end = ta?.selectionEnd ?? text.length;
		const sep = start > 0 && !/\s$/.test(text.slice(0, start)) ? " " : "";
		const next = text.slice(0, start) + sep + t + text.slice(end);
		useDraftStore.getState().setDraftText(sidequestId, next);
		requestAnimationFrame(() => {
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = start + sep.length + t.length;
		});
	};

	const stop = async () => {
		if (interrupting) return;
		setInterrupting(true);
		try {
			await window.claude.interruptSession(sidequestId);
		} finally {
			setInterrupting(false);
		}
	};

	// Enter commits an in-progress recording wherever focus is, so you don't
	// have to click back into the panel to finish dictating. Capture phase to
	// beat the textarea's own handler. Only mounted while *this* composer is
	// recording, and it ignores other text fields — so the main chat's
	// identical listener and this one can never fight over the same keystroke.
	useEffect(() => {
		if (!dictating) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Enter") return;
			if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (
				target
				&& target !== textareaRef.current
				&& (target.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
			) {
				return;
			}
			if (!dictationRef.current?.commitIfRecording()) return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [dictating]);

	// Escape discards an in-progress recording — nothing is transcribed or
	// inserted. Same guards as the Enter listener above, and it only swallows
	// the key when a recording was actually cancelled, so Escape still reaches
	// modals and context menus the rest of the time.
	useEffect(() => {
		if (!dictating) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (
				target
				&& target !== textareaRef.current
				&& (target.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
			) {
				return;
			}
			if (!dictationRef.current?.cancelIfRecording()) return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [dictating]);

	// ── Resize model — identical to SessionChat's chat input ────────────────
	// `inputHeight` is the single source of truth for the rendered height,
	// updated by either (1) the drag handle, any direction, set directly, or
	// (2) content measurement — but ONLY to push the height UP. Content
	// measurement never shrinks it, so a manual drag-down is preserved and the
	// textarea scrolls internally past the dragged height.
	//
	// Default is taller than the main composer's 44px: this box has no visible
	// send button/model bar competing for space above it, and the transcript
	// above still gets the majority of the panel (see `maxInputHeight` below).
	const [inputHeight, setInputHeight] = useState(72);
	// Cap at 45% of the window so the transcript keeps the majority of the
	// panel. The 120px floor keeps it usable on short windows.
	const maxInputHeight = Math.max(120, Math.floor(window.innerHeight * 0.45));
	const dragRef = useRef<{
		startY: number;
		startHeight: number;
		lastHeight: number;
	} | null>(null);
	// Manual-size lock: set after a drag-DOWN so typing can't undo a
	// deliberate shrink. Released by a drag-UP or by the textarea emptying
	// out, so each new message starts in auto-grow mode.
	const isManualRef = useRef(false);

	const onContentHeightChange = useCallback(
		(sh: number) => {
			// Essentially empty (post-send, or all text deleted) — reset the
			// lock so the next typing session auto-grows again.
			if (sh <= 50) isManualRef.current = false;
			if (isManualRef.current) return;
			setInputHeight((prev) =>
				sh > prev ? Math.min(maxInputHeight, Math.max(44, sh)) : prev,
			);
		},
		[maxInputHeight],
	);

	// Auto-grow to fit content. Toggle height to "auto" just long enough to
	// read scrollHeight (the natural content height), then restore it so the
	// controlled style prop wins on the next render. useLayoutEffect runs
	// before paint, so the swap never flashes.
	useLayoutEffect(() => {
		const ta = textareaRef.current;
		if (!ta) return;
		const prev = ta.style.height;
		ta.style.height = "auto";
		const sh = ta.scrollHeight;
		ta.style.height = prev;
		onContentHeightChange(sh);
	}, [text, onContentHeightChange]);

	const onDividerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		dragRef.current = {
			startY: e.clientY,
			startHeight: inputHeight,
			lastHeight: inputHeight,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ns-resize";
	};
	const onDividerPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		const next = Math.min(
			maxInputHeight,
			Math.max(44, d.startHeight - (e.clientY - d.startY)),
		);
		d.lastHeight = next;
		setInputHeight(next);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		// Apply the lock from the drag's final direction: drag-down locks the
		// smaller size, drag-up releases. A click without movement is a no-op.
		if (d.lastHeight < d.startHeight) isManualRef.current = true;
		else if (d.lastHeight > d.startHeight) isManualRef.current = false;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
	};

	// Focus + caret to end whenever something asks for it (Cmd+S, Clear) or the
	// sidequest is swapped out from under us. rAF so it survives the mount /
	// re-render that a fresh fork triggers.
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = ta.value.length;
		});
		return () => cancelAnimationFrame(raf);
	}, [focusNonce, sidequestId]);

	const send = async () => {
		if (sending || !canSend) return;
		const trimmed = text.trim();
		const blocks = buildUserBlocks(text, images);
		// Captured before clearDraft wipes the store entry — the restore path
		// below has to put images back too, not just the text.
		const sentImages = images;
		// Clear optimistically — the turn comes back to the transcript via the
		// `sidequest:message` broadcast main fires from `pushUserMessage`.
		useDraftStore.getState().clearDraft(sidequestId);
		setSending(true);
		setError(null);
		try {
			await window.claude.sendUserMessage({ sessionId: sidequestId, blocks });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			// Put the whole draft back so nothing is lost — losing a multi-MB
			// pasted screenshot to a transient IPC failure is not recoverable.
			// Both setters re-read the current draft, so the order is safe.
			useDraftStore.getState().setDraftImages(sidequestId, sentImages);
			useDraftStore.getState().setDraftText(sidequestId, trimmed);
		} finally {
			setSending(false);
		}
	};

	return (
		<div style={{ flexShrink: 0, display: "flex", flexDirection: "column" }}>
			<div
				onPointerDown={onDividerPointerDown}
				onPointerMove={onDividerPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize sidequest input"
				style={{
					flexShrink: 0,
					height: 6,
					cursor: "ns-resize",
					display: "flex",
					alignItems: "center",
					touchAction: "none",
				}}
			>
				<div style={{ height: 1, width: "100%", background: T.borderSoft }} />
			</div>
			{/* Same spot the main chat's model label lives (`SessionTokenBar`):
			    its own thin bar directly above the composer box, below the
			    divider line — not inside the composer, not above the line. */}
			<div
				style={{
					flexShrink: 0,
					display: "flex",
					justifyContent: "flex-end",
					padding: "6px 16px 0",
					fontSize: 11,
					fontFamily: T.mono,
					userSelect: "none",
				}}
			>
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					onMouseEnter={() => setModelHover(true)}
					onMouseLeave={() => setModelHover(false)}
					style={{
						padding: 0,
						border: "none",
						background: "none",
						font: "inherit",
						fontStyle: displayed.pending ? "italic" : "normal",
						color: displayed.pending
							? T.textMute
							: modelHover
								? T.text
								: T.textDim,
						textDecoration: modelHover ? "underline" : "none",
						textUnderlineOffset: 3,
						cursor: "pointer",
					}}
				>
					{displayed.model ? formatModelName(displayed.model) : "Default"}
					{displayed.pending ? "…" : ""}
				</button>
			</div>
			<div
				style={{
					padding: "10px 16px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{error ? (
					<div style={{ fontSize: 11.5, color: T.danger }}>{error}</div>
				) : null}
				<div
					style={{
						position: "relative",
						boxSizing: "border-box",
						padding: 10,
						borderRadius: 10,
						border: `0.5px solid ${T.border}`,
						background: T.surfaceLow,
					}}
				>
					{/* Same corner placement as the main composer's Stop button
					    (`ImagePasteTextarea`) — top-right of the input box, not
					    inline with Send. */}
					{running ? (
						<button
							type="button"
							onClick={() => void stop()}
							disabled={interrupting}
							aria-label="Stop"
							style={{
								position: "absolute",
								top: 8,
								right: 8,
								zIndex: 1,
								height: 22,
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								padding: "0 8px",
								borderRadius: 5,
								border: `0.5px solid ${T.border}`,
								background: T.surfaceHi,
								color: T.text,
								fontFamily: "inherit",
								fontSize: 11.5,
								fontWeight: 500,
								lineHeight: 1,
								cursor: interrupting ? "default" : "pointer",
								opacity: interrupting ? 0.55 : 1,
							}}
						>
							<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
								<rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
							</svg>
							<span>{interrupting ? "Stopping…" : "Stop"}</span>
						</button>
					) : null}
					{/* Same placement as the main composer: thumbnails sit above
					    the textarea, inside the input box. Smaller here because
					    the panel goes as narrow as SIDEQUEST_MIN_WIDTH (280px).
					    The right inset keeps the last thumbnail's "×" clear of
					    the Stop button floating in that corner — staging a
					    follow-up while Claude is still working is normal here. */}
					<div style={{ paddingRight: running ? 64 : 0 }}>
						<PendingImageStrip
							images={images}
							size={48}
							onRemove={removeImage}
							onError={setError}
						/>
					</div>
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) =>
							useDraftStore.getState().setDraftText(sidequestId, e.target.value)
						}
						onPaste={onPaste}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								// While dictating, Enter commits the recording rather
								// than firing off a half-finished message. A second
								// Enter sends.
								if (dictationRef.current?.commitIfRecording()) return;
								void send();
							}
						}}
						placeholder="Ask a quick question…"
						style={{
							width: "100%",
							height: inputHeight,
							resize: "none",
							background: "transparent",
							border: "none",
							outline: "none",
							color: T.text,
							fontFamily: T.sans,
							fontSize: 13,
							lineHeight: 1.5,
							padding: 0,
							overflowY: "auto",
						}}
					/>
				</div>
				{/* Controls row. Wraps rather than overflowing — the panel goes
				    as narrow as 280px (SIDEQUEST_MIN_WIDTH). */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap",
					}}
				>
					<DictationButton
						ref={dictationRef}
						disabled={starting}
						onRecordingChange={setDictating}
						onInsert={insertDictation}
						onError={setError}
					/>
					<ModeToggle
						mode={sq.mode}
						onChange={(next) => void changeMode(next)}
						disabled={starting || modeSwitching}
					/>
					<div style={{ flex: 1, minWidth: 0 }} />
					{dictating ? (
						<span style={{ fontSize: 11, color: T.textFaint }}>
							↵ finish · esc cancel
						</span>
					) : null}
				</div>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
					<button
						type="button"
						onClick={() => void send()}
						disabled={!canSend || sending}
						style={{
							padding: "6px 14px",
							borderRadius: 8,
							border: `0.5px solid ${canSend ? T.accentBorder : T.border}`,
							background: canSend ? T.accentSoft : T.surface,
							color: canSend ? T.text : T.textFaint,
							fontSize: 12.5,
							fontWeight: 500,
							cursor: canSend && !sending ? "pointer" : "default",
							opacity: sending ? 0.55 : 1,
							fontFamily: T.sans,
						}}
					>
						Send
					</button>
				</div>
			</div>
			{/* Same picker the main chat uses. `getSupportedModels(sidequestId)`
			    resolves against the sidequest's own live query, so the list is
			    exactly what this fork can spawn. Selection goes through the
			    normal `setSessionModel` IPC — SessionManager takes the ephemeral
			    branch and answers on `sidequest:patch`, so there's no optimistic
			    write to reconcile here. */}
			<ModelPickerModal
				open={pickerOpen}
				sessionId={sidequestId}
				effectiveModel={displayed.model}
				onSelect={(value) => window.claude.setSessionModel(sidequestId, value)}
				onClose={() => setPickerOpen(false)}
			/>
		</div>
	);
}
