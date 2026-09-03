import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useInterruptStore } from "../stores/useInterruptStore";
import { useReadStore } from "../stores/useReadStore";
import { isDraftId, useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { focusComposer } from "../lib/composerActions";
import { stopSession } from "../lib/sessionControlActions";
import { startHandoff } from "../lib/handoffActions";
import { PermissionCard } from "./PermissionCard";
import { ActivityChip } from "./ActivityChip";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { MessageView } from "./MessageView";
import { SessionTokenBar } from "./SessionTokenBar";
import { ToolRunGroup } from "./ToolRunGroup";
import { DraftSessionChat } from "./DraftSessionChat";
import { groupMessagesIntoUnits } from "../lib/groupMessages";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import { BranchChipWithDelta, StatusPill } from "../../../design/Atoms";
import { WorktreeChip } from "../../../design/WorktreeChip";

export function SessionChat({ sessionId }: { sessionId: string }) {
	// Draft sessions (UI-only, not yet persisted) live at /sessions/draft-<id>
	// and render through a stripped-down shell that skips the transcript /
	// fork / permission / branch affordances — none of those apply pre-creation.
	// The draft → real promotion runs inside ImagePasteTextarea.send().
	if (isDraftId(sessionId)) return <DraftSessionChat draftId={sessionId} />;
	const navigate = useNavigate();
	const session = useSessionsStore((s) => s.sessions[sessionId]);
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	// Attached worktree, if any. Session bindings are permanent, but the
	// registry entry can still be mutated (displayName changed, etc.) —
	// selector keeps the badge live.
	const attachedWorktree = useWorktreesStore((s) =>
		session?.worktreeId ? s.worktrees[session.worktreeId] : undefined,
	);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);
	// Lives in a store, not local state, so the Stop pill and the global ⌘.
	// hotkey share one in-flight guard — see `stopSession`.
	const interrupting = useInterruptStore((s) => !!s.interrupting[sessionId]);
	const [forkingId, setForkingId] = useState<string | null>(null);
	const [forkError, setForkError] = useState<string | null>(null);
	const [pendingForkMessageId, setPendingForkMessageId] = useState<
		string | null
	>(null);
	// Object, not a bare string — "" is a legal handoff text (shouldn't
	// happen given the canHandoff gate, but falsy-collision with `null`
	// would silently misbehave `open={!!pendingHandoff}`).
	const [pendingHandoff, setPendingHandoff] = useState<{
		text: string;
		hasDirtyDraft: boolean;
	} | null>(null);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [openFolderModal, setOpenFolderModal] = useState(false);
	const titleInputRef = useRef<HTMLInputElement>(null);
	// `inputHeight` is the single source of truth for the chat textarea's
	// rendered height. It's updated by either:
	//   (1) the drag handle (any direction, sets it directly), or
	//   (2) content measurement via `onContentHeightChange` — but ONLY
	//       to push the height UP when scrollHeight exceeds the current
	//       height. Content measurement never shrinks `inputHeight`, so
	//       a manual drag-down is preserved and the textarea scrolls
	//       internally (overflowY: auto) past the dragged height.
	const [inputHeight, setInputHeight] = useState(44);
	// Cap the chat textarea at 45% of the window so the message transcript
	// always keeps the majority of the viewport. The 120px floor keeps the
	// textarea usable on tiny windows where 45% would be cramped.
	const maxInputHeight = Math.max(120, Math.floor(window.innerHeight * 0.45));
	const dragRef = useRef<{
		startY: number;
		startHeight: number;
		lastHeight: number;
	} | null>(null);
	// Manual-size lock: set true after a drag-DOWN so subsequent typing
	// can't undo the user's deliberate shrink. Released by either a
	// drag-UP past the original size or by the textarea emptying out
	// (e.g. after sending), so each new message starts in auto-grow mode.
	const isManualRef = useRef(false);

	const onContentHeightChange = useCallback(
		(sh: number) => {
			// Textarea is essentially empty (post-send, or all text deleted).
			// Reset the manual lock so the next typing session auto-grows.
			// Empty Chromium textarea with default rows=2 reports
			// scrollHeight ≈ 42–46, so 50 is a safe threshold.
			if (sh <= 50) {
				isManualRef.current = false;
			}
			// While locked (after a drag-down), don't auto-grow — let the
			// textarea's overflowY: auto scroll content internally instead.
			if (isManualRef.current) return;
			setInputHeight((prev) =>
				sh > prev
					? Math.min(maxInputHeight, Math.max(44, sh))
					: prev,
			);
		},
		[maxInputHeight],
	);

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
		const delta = e.clientY - d.startY;
		const newHeight = Math.min(
			maxInputHeight,
			Math.max(44, d.startHeight - delta),
		);
		d.lastHeight = newHeight;
		setInputHeight(newHeight);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		// Apply the manual-lock rule from the drag's final direction:
		// drag-down locks the smaller size; drag-up releases any prior lock.
		// A click without movement leaves the flag unchanged.
		if (d.lastHeight < d.startHeight) {
			isManualRef.current = true;
		} else if (d.lastHeight > d.startHeight) {
			isManualRef.current = false;
		}
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
	};

	const isOpen =
		session?.status === "running" ||
		session?.status === "idle" ||
		session?.status === "awaiting_permission";
	const canChat = isOpen || !!session?.sdkSessionId;

	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const messageCount = session?.messages.length ?? 0;
	const pendingCount = pending.length;

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !stickToBottom.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messageCount, pendingCount]);

	useEffect(() => {
		useReadStore.getState().markRead(sessionId);
	}, [sessionId, messageCount, pendingCount]);

	// Re-read the live git branch whenever the user opens / switches into a
	// session. If it changed since the user's last message, the chip flips
	// red (computed downstream from session.branch vs lastUserMessageBranch).
	useEffect(() => {
		void window.claude.refreshBranch(sessionId);
	}, [sessionId]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		stickToBottom.current = distance < 80;
	};

	const beginEditTitle = () => {
		setTitleDraft(session?.title ?? "");
		setEditingTitle(true);
		// Focus + select on next tick once the input is mounted.
		setTimeout(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		}, 0);
	};

	const commitTitle = async () => {
		if (!session) return;
		const next = titleDraft.trim();
		setEditingTitle(false);
		if (!next || next === session.title) return;
		const previous = session.title;
		// Optimistic update — server will broadcast a patch back, but updating
		// locally first avoids a flicker.
		upsertSession({ id: sessionId, title: next });
		try {
			await window.claude.renameSession(sessionId, next);
		} catch (err) {
			upsertSession({ id: sessionId, title: previous });
			console.error("Failed to rename session", err);
		}
	};

	// useCallback so MessageView's React.memo can short-circuit re-renders.
	// forkingId is in deps because we early-return when a fork is in flight;
	// during the brief fork window the identity changes once, which is fine.
	// Clicking the fork icon only *stages* the fork — the actual IPC call
	// runs from confirmFork() after the user confirms in the modal.
	const fork = useCallback(
		(messageId: string) => {
			if (forkingId) return;
			setForkError(null);
			setPendingForkMessageId(messageId);
		},
		[forkingId],
	);

	const confirmFork = async () => {
		const messageId = pendingForkMessageId;
		if (!messageId || forkingId) return;
		setForkingId(messageId);
		setForkError(null);
		try {
			const next = await window.claude.forkSession(sessionId, messageId);
			setPendingForkMessageId(null);
			navigate(`/sessions/${next.id}`);
		} catch (err) {
			setForkError(err instanceof Error ? err.message : String(err));
		} finally {
			setForkingId(null);
		}
	};

	const cancelFork = () => {
		if (forkingId) return;
		setPendingForkMessageId(null);
		setForkError(null);
	};

	// useCallback with an empty dep array so MessageView's React.memo keeps
	// short-circuiting re-renders — the session and draft state are read
	// fresh from the stores at click time instead of being captured in
	// closure deps.
	const handoff = useCallback((text: string) => {
		const draft = useDraftSessionsStore.getState().draft;
		const draftText = draft
			? useDraftStore.getState().draftsBySession[draft.id]?.text
			: undefined;
		setPendingHandoff({ text, hasDirtyDraft: !!draftText });
	}, []);

	// Stages a new session (draft, not yet created) pre-filled with the
	// handoff text and, for "Handoff & delete", remembers to remove this
	// session once the new one actually receives its first message —
	// ImagePasteTextarea.send() is what fires that deferred delete.
	const runHandoff = (deleteOld: boolean) => {
		if (!pendingHandoff || !session) return;
		setPendingHandoff(null);
		const id = startHandoff({
			session,
			text: pendingHandoff.text,
			deleteOld,
		});
		navigate(`/sessions/${id}`);
		focusComposer();
	};

	// Pre-pass over messages to collapse contiguous tool_use + tool_result
	// blocks (across message boundaries) into a single <ToolRunGroup/>.
	// Memoized so React.memo on MessageView/ToolRunGroup can short-circuit
	// re-renders — messages are append-only so the same units come back with
	// the same identity until the array grows.
	const renderUnits = useMemo(
		() => groupMessagesIntoUnits(session?.messages ?? []),
		[session?.messages],
	);

	if (!session) {
		return (
			<div className="page">
				<div className="message">Session not found.</div>
			</div>
		);
	}

	const effectiveStatus =
		pending.length > 0 ? "awaiting_permission" : session.status;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				background: T.win,
			}}
		>
			{/* Breadcrumb header */}
			<div
				style={{
					flexShrink: 0,
					borderBottom: `0.5px solid ${T.border}`,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					padding: "10px 18px",
					background: T.win,
				}}
			>
				{/* Row 0: worktree badge (only when this session is bound to
				    one). Sits ABOVE the title row per product decision so it
				    reads as a scope marker rather than a peer status chip. */}
				{attachedWorktree ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							minWidth: 0,
						}}
					>
						<WorktreeChip
							displayName={attachedWorktree.displayName}
							color={attachedWorktree.color}
							variant="readonly"
						/>
					</div>
				) : null}
				{/* Row 1: title, filepath, action buttons */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 14,
						minWidth: 0,
					}}
				>
					{editingTitle ? (
						<input
							ref={titleInputRef}
							value={titleDraft}
							onChange={(e) => setTitleDraft(e.target.value)}
							onBlur={() => {
								void commitTitle();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									void commitTitle();
								} else if (e.key === "Escape") {
									e.preventDefault();
									setEditingTitle(false);
								}
							}}
							maxLength={200}
							style={{
								fontSize: 14,
								fontWeight: 600,
								color: T.text,
								background: T.surface,
								border: `0.5px solid ${T.border}`,
								borderRadius: 6,
								padding: "3px 7px",
								outline: "none",
								maxWidth: 320,
								minWidth: 120,
								flexShrink: 0,
								fontFamily: "inherit",
							}}
						/>
					) : (
						<div
							className="session-title"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								fontSize: 14,
								fontWeight: 600,
								color: T.text,
								maxWidth: 360,
								flexShrink: 0,
								minWidth: 0,
							}}
						>
							<span
								onClick={beginEditTitle}
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									cursor: "pointer",
								}}
							>
								{session.title}
							</span>
							<button
								type="button"
								onClick={beginEditTitle}
								aria-label="Rename session"
								className="session-title-edit"
								style={{
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									width: 22,
									height: 22,
									padding: 0,
									borderRadius: 5,
									border: "none",
									background: "transparent",
									color: T.textFaint,
									cursor: "pointer",
									flexShrink: 0,
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.background = T.surfaceHi;
									e.currentTarget.style.color = T.text;
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background = "transparent";
									e.currentTarget.style.color = T.textFaint;
								}}
							>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
									<path
										d="M8.2 1.8a1.1 1.1 0 011.6 1.6L4.3 8.9 2 9.5l.6-2.3 5.6-5.4z"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
						</div>
					)}
					{session.cwd ? (
						<button
							type="button"
							aria-label={`${session.cwd} — click to open in Finder`}
							onClick={() => setOpenFolderModal(true)}
							style={{
								fontFamily: T.mono,
								fontSize: 11.5,
								color: T.textFaint,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								minWidth: 0,
								flex: 1,
								textAlign: "left",
								background: "transparent",
								border: "none",
								padding: 0,
								margin: 0,
								cursor: "pointer",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.color = T.text;
								e.currentTarget.style.textDecoration = "underline";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.color = T.textFaint;
								e.currentTarget.style.textDecoration = "none";
							}}
						>
							{session.cwd.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() || session.cwd}
						</button>
					) : (
						<div style={{ flex: 1 }} />
					)}

				</div>

				{/* Row 2: status chips */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						flexWrap: "wrap",
					}}
				>
					<StatusPill
						status={effectiveStatus}
						mode={session.mode}
						pendingToolName={pending[0]?.toolName}
					/>
					<BranchChipWithDelta
						branch={session.branch}
						lastUserMessageBranch={session.lastUserMessageBranch}
						sessionId={sessionId}
					/>
				</div>
			</div>

			{/* Transcript (with floating chip overlay) */}
			<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
				<div
					ref={scrollRef}
					onScroll={onScroll}
					style={{
						height: "100%",
						overflow: "auto",
						padding: "28px 32px 14px",
					}}
				>
					<div style={{ maxWidth: 760, margin: "0 auto" }}>
						{session.messages.length === 0 && pending.length === 0 ? (
							<div className="message">Waiting for first message…</div>
						) : (
							// The `data-message-id` wrappers are how a text selection
							// maps back to a message: the Cmd+S sidequest handler walks
							// up from the selection anchor with `closest()` to find the
							// fork point. Style-neutral block wrappers — every unit's
							// own root already carries its spacing/width.
							renderUnits.map((u) => {
								if (u.kind === "toolRun") {
									return (
										<div
											key={u.key}
											data-message-id={u.entries[0]?.messageId}
											data-role="toolRun"
										>
											<ToolRunGroup entries={u.entries} />
										</div>
									);
								}
								return (
									<div
										key={u.message.id}
										data-message-id={u.message.id}
										data-role={u.message.role}
									>
										<MessageView
											m={u.message}
											onFork={fork}
											forkPending={forkingId === u.message.id}
											onHandoff={handoff}
										/>
									</div>
								);
							})
						)}
						{pending.length > 0 ? (
							<div
								style={{
									maxWidth: 760,
									margin: "20px auto",
									display: "flex",
									flexDirection: "column",
									gap: 12,
								}}
							>
								{pending.map((p) => (
									<PermissionCard key={p.requestId} req={p} />
								))}
							</div>
						) : null}
					</div>
				</div>

				{canChat ? (
					<div
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							padding: "0 32px 4px",
							pointerEvents: "none",
						}}
					>
						<div
							style={{
								maxWidth: 760,
								margin: "0 auto",
								display: "flex",
								justifyContent: "flex-end",
							}}
						>
							<div style={{ pointerEvents: "auto" }}>
								{isOpen ? (
									<ActivityChip
										session={session}
										hasPending={pending.length > 0}
										// The chip renders for any non-idle status, but only a
										// running turn can be interrupted — same guard as
										// `useStopSessionHotkey`. No `onStop` ⇒ no "×", inert chip.
										onStop={
											session.status === "running"
												? () => void stopSession(sessionId)
												: undefined
										}
										interrupting={interrupting}
									/>
								) : null}
							</div>
						</div>
					</div>
				) : null}
			</div>

			{canChat ? (
				<div
					onPointerDown={onDividerPointerDown}
					onPointerMove={onDividerPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize chat input"
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
			) : null}

			{forkError && !pendingForkMessageId ? (
				<div
					className="message message-error"
					style={{ margin: 12, padding: 8, fontSize: 12 }}
				>
					Fork failed: {forkError}
				</div>
			) : null}

			{canChat ? <SessionTokenBar session={session} /> : null}

			{canChat ? (
				<ImagePasteTextarea
					sessionId={sessionId}
					textareaHeight={inputHeight}
					onContentHeightChange={onContentHeightChange}
					disabled={pending.length > 0}
				/>
			) : null}

			<ConfirmModal
				open={!!pendingForkMessageId}
				title="Fork conversation?"
				message="Start a new session that branches from this message. The current session stays intact."
				confirmLabel="Fork"
				cancelLabel="Cancel"
				busy={!!forkingId}
				error={forkError}
				onConfirm={confirmFork}
				onCancel={cancelFork}
			/>

			<ConfirmModal
				open={!!pendingHandoff}
				title="Hand off to a new session?"
				message={
					<>
						Start a new session in the same folder
						{session.groupId ? ", group," : ""} and mode, with this message
						pre-filled in the composer. Nothing is sent until you press
						Enter.
						{pendingHandoff?.hasDirtyDraft
							? " Your current unsent draft will be replaced."
							: ""}
					</>
				}
				confirmLabel="Handoff & delete"
				secondaryAction={{
					label: "Handoff",
					onClick: () => runHandoff(false),
				}}
				onConfirm={() => runHandoff(true)}
				onCancel={() => setPendingHandoff(null)}
			/>

			<ConfirmModal
				open={openFolderModal}
				title="Open folder in Finder?"
				message={
					<>
						Reveal{" "}
						<code style={{ fontFamily: T.mono, fontSize: 12 }}>
							{session.cwd}
						</code>{" "}
						in Finder?
					</>
				}
				confirmLabel="Open in Finder"
				cancelLabel="Cancel"
				extraAction={{
					label: "Copy path",
					onClick: async () => {
						try {
							await navigator.clipboard.writeText(session.cwd ?? "");
						} catch {
							// noop — clipboard write can fail in some contexts
						}
						setOpenFolderModal(false);
					},
				}}
				onConfirm={() => {
					void window.claude.revealPath(session.cwd ?? "");
					setOpenFolderModal(false);
				}}
				onCancel={() => setOpenFolderModal(false)}
			/>
		</div>
	);
}

// ActivityChip — the floating "working ⟳ 12s" indicator, and also the stop
// control (whole pill clicks to interrupt) — moved to ./ActivityChip so the
// sidequest panel can render the identical chip.
