import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionsStore } from "../../stores/useSessionsStore";
import { useInterruptStore } from "../../stores/useInterruptStore";
import { usePermissionsStore } from "../../stores/usePermissionsStore";
import { useSidequestsStore } from "../../stores/useSidequestsStore";
import { groupMessagesIntoUnits } from "../../lib/groupMessages";
import { lastForkableMessageId } from "../../lib/sidequestForkPoint";
import {
	openSidequestPanelAndFocus,
	recreateSidequest,
} from "../../lib/sidequestActions";
import { stopSidequest } from "../../lib/sessionControlActions";
import { useComposerResize } from "../../hooks/useComposerResize";
import { MessageView } from "../MessageView";
import { ActivityChip } from "../ActivityChip";
import { ToolRunGroup } from "../ToolRunGroup";
import { PermissionCard } from "../PermissionCard";
import { ComposerDivider } from "../ComposerDivider";
import { SessionTokenBar } from "../SessionTokenBar";
import { MessageComposer } from "../MessageComposer";
import { T } from "../../../../design/tokens";
import { StatusPill } from "../../../../design/Atoms";

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
	const [clearing, setClearing] = useState(false);
	const [forkingId, setForkingId] = useState<string | null>(null);
	const [forkError, setForkError] = useState<string | null>(null);
	const navigate = useNavigate();
	// Sidequest input's drag-to-resize + auto-grow model — shared with
	// SessionChat's chat input via `useComposerResize`. Kept at the panel's
	// top level (not inside a conditional) since hooks must run
	// unconditionally; the `!sq` empty state simply never renders the divider
	// or composer that consume it.
	const resize = useComposerResize({ initialHeight: 72 });

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

	// Shared with the main chat's chip via `useInterruptStore`, which is keyed
	// by plain id — a sidequest id works there even though it has no store row.
	const interrupting = useInterruptStore((s) =>
		sq ? !!s.interrupting[sq.sidequestId] : false,
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
			// last Claude reply in the main thread. The draft rides along:
			// Clear is about throwing away the *conversation*, and taking a
			// half-typed question and its pasted screenshots with it was never
			// the point.
			await recreateSidequest(sessionId, forkMessageId, {
				preserveDraft: true,
			});
			openSidequestPanelAndFocus(sessionId);
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
							mode={sq.mode}
							pendingToolName={pending[0]?.toolName}
							onClick={
								pending.length === 0 && sq.status === "usage_limit"
									? () => {
										void window.claude
											.retryUsageLimit(sq.sidequestId)
											.catch((err) => {
												// See the main session row's
												// identical catch — composer
												// send is always a working
												// fallback.
												console.error(
													"[ccw] retryUsageLimit failed:",
													err,
												);
											});
									}
									: undefined
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
			    identical bottom-right float, and (once running) the same stop
			    control: the whole pill is clickable. "starting" shows it too:
			    branching is activity, and the chip's elapsed clock runs off
			    `createdAt` until the first message lands. Hidden while a
			    permission card is up (the chip nulls itself on `hasPending`),
			    matching SessionChat. */}
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
								// "starting" deliberately gets no "×": there's no live
								// query to interrupt until the fork lands.
								onStop={
									sq.status === "running"
										? () => void stopSidequest(sq.sidequestId)
										: undefined
								}
								interrupting={interrupting}
							/>
						</div>
					</div>
				) : null}
			</div>

			{sq ? (
				<>
					<ComposerDivider
						{...resize.dividerProps}
						ariaLabel="Resize sidequest input"
					/>
					{/* Same bar the main chat's composer shows above its textarea —
					    token count + model label — generalized to accept a
					    sidequest's in-memory state (no `useSessionsStore` row) via
					    `TokenBarTarget`. */}
					<SessionTokenBar
						target={{
							id: sq.sidequestId,
							messages: sq.messages,
							model: sq.model,
							modelChangedAt: sq.modelChangedAt,
							status: sq.status,
						}}
						density="compact"
						onAfterSelect={() => openSidequestPanelAndFocus(sessionId)}
					/>
					{/* Same composer the main chat uses — queuing, the ⚡
					    shortcuts/skills menu, and every keyboard affordance now
					    come along for free. Per-kind branching (send path, mode
					    changes, no draft-promotion lifecycle) lives behind
					    `useComposerTarget`, keyed off `sq.sidequestId` being a
					    sidequest id. `disabled` on a pending permission matches
					    `SessionChat` — see `useComposerFocusHotkey`'s doc, which
					    already assumed this was true. */}
					<MessageComposer
						sessionId={sq.sidequestId}
						density="compact"
						textareaHeight={resize.height}
						onContentHeightChange={resize.onContentHeightChange}
						disabled={pending.length > 0}
					/>
				</>
			) : null}
		</div>
	);
}
