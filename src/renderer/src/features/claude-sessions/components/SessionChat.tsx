import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { PermissionCard } from "./PermissionCard";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { MessageView } from "./MessageView";
import { ToolRunGroup } from "./ToolRunGroup";
import { groupMessagesIntoUnits } from "../lib/groupMessages";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import { BranchChipWithDelta, StatusPill } from "../../../design/Atoms";
import { WorktreeLinkModal } from "./WorktreeLinkModal";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { useEphemeralSessionsStore } from "../stores/useEphemeralSessionsStore";
import type {
	ClaudeSessionFull,
	UserContentBlock,
} from "@shared/claude-sessions/types";

export function SessionChat({ sessionId }: { sessionId: string }) {
	const navigate = useNavigate();
	const realSession = useSessionsStore((s) => s.sessions[sessionId]);
	const ephemeralDraft = useEphemeralSessionsStore(
		(s) => s.drafts[sessionId],
	);
	const removeDraft = useEphemeralSessionsStore((s) => s.remove);
	// Adapt the ephemeral draft (if any) into a ClaudeSessionFull-shaped
	// object so the rest of this component renders without per-field
	// branches. Drafts have no messages, no SDK loop, status "idle",
	// no worktree link (worktree linking IS what promotes them).
	const session: ClaudeSessionFull | undefined =
		realSession ??
		(ephemeralDraft
			? {
				id: ephemeralDraft.id,
				title: ephemeralDraft.title,
				prompt: "",
				cwd: ephemeralDraft.cwd,
				status: "idle",
				createdAt: ephemeralDraft.createdAt,
				mode: ephemeralDraft.mode,
				messages: [],
			}
			: undefined);
	const isEphemeral = !realSession && !!ephemeralDraft;
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);
	const [interrupting, setInterrupting] = useState(false);
	const [resuming, setResuming] = useState(false);
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [forkingId, setForkingId] = useState<string | null>(null);
	const [forkError, setForkError] = useState<string | null>(null);
	const [pendingForkMessageId, setPendingForkMessageId] = useState<
		string | null
	>(null);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [openFolderModal, setOpenFolderModal] = useState(false);
	const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);
	// Worktree record this session is linked to, if any. The map is hydrated
	// at app boot (and re-hydrated on every state:changed ping), so the
	// lookup is just an indexed read.
	const linkedWorktree = useWorktreesStore((s) =>
		session?.worktreeId ? s.worktrees[session.worktreeId] : undefined,
	);
	// User-facing cwd. When linked, the worktree's physical folder
	// (`session.cwd` = `<dataDir>/worktrees/<uuid>`) is an implementation
	// detail — the user thinks of the session as working "in
	// bank-analytics", not "in 021d56dc-…". Surface the original repo
	// path everywhere a path is shown / opened / copied. The session's
	// actual cwd stays as the worktree path internally so SDK + git ops
	// still run there.
	const displayCwd = linkedWorktree?.originalCwd ?? session?.cwd ?? "";
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
	// Ephemeral drafts can chat too — sending a message is one of the two
	// ways to promote a draft into a real session (the other being a
	// worktree link). canChat → render the textarea.
	const canChat = isOpen || !!session?.sdkSessionId || isEphemeral;

	/**
	 * Promote an ephemeral draft into a real, persisted session. Two
	 * trigger points share this implementation:
	 *   - The user sends a first message (text + optional images).
	 *   - The user picks a worktree in the link modal.
	 *
	 * `args.firstMessageText` becomes the SDK's first user turn via
	 * `StartSessionInput.prompt`. `args.firstMessageImages`, if any,
	 * are pushed as a follow-up turn after `session:started` lands the
	 * real row in the store — `StartSessionInput.prompt` is text-only,
	 * so images-on-first-turn is implemented as a separate user message
	 * once the SDK loop is alive.
	 *
	 * After `session:start` returns (immediately — the SDK loop runs in
	 * the background), we replace-navigate from the draft id to the real
	 * one and drop the draft from the renderer store.
	 */
	async function promoteEphemeral(args: {
		firstMessageText?: string;
		firstMessageImages?: UserContentBlock[];
		worktree?:
			| { kind: "new"; branch: string }
			| { kind: "existing"; worktreeId: string };
	}): Promise<void> {
		if (!ephemeralDraft) throw new Error("No ephemeral draft to promote");
		const real = await window.claude.startSession({
			title: ephemeralDraft.title,
			cwd: ephemeralDraft.cwd,
			mode: ephemeralDraft.mode,
			prompt: args.firstMessageText,
			worktree: args.worktree,
		});
		// Drop the draft now that we have the real id — the URL swap
		// below will unmount the ephemeral render path anyway, but
		// removing it eagerly also drops the row from the sidebar.
		removeDraft(ephemeralDraft.id);
		navigate(`/sessions/${real.id}`, { replace: true });
		// Images-on-first-turn follow-up. The SDK loop is alive in the
		// background by now (session:start returned synchronously after
		// the persist), so the follow-up turn queues onto its userStream.
		if (args.firstMessageImages && args.firstMessageImages.length > 0) {
			try {
				await window.claude.sendUserMessage({
					sessionId: real.id,
					blocks: args.firstMessageImages,
				});
			} catch (err) {
				console.error(
					"[ccw] first-turn image follow-up failed:",
					err,
				);
			}
		}
	}

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

	const stop = async () => {
		if (interrupting) return;
		setInterrupting(true);
		try {
			await window.claude.interruptSession(sessionId);
		} finally {
			setInterrupting(false);
		}
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

	const resume = async () => {
		if (resuming) return;
		setResuming(true);
		setResumeError(null);
		try {
			await window.claude.resumeSession(sessionId);
		} catch (err) {
			setResumeError(err instanceof Error ? err.message : String(err));
		} finally {
			setResuming(false);
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
								title={session.title}
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{session.title}
							</span>
							<button
								type="button"
								onClick={beginEditTitle}
								title="Rename session"
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
							title={`${displayCwd}\n(click to open in Finder)`}
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
							{displayCwd.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() ||
								displayCwd}
						</button>
					) : (
						<div style={{ flex: 1 }} />
					)}

					<WorktreeChip
						linked={linkedWorktree}
						clickable={isEphemeral}
						onClick={() => setWorktreeModalOpen(true)}
					/>

					{session.status === "running" ? (
						<button
							className="btn"
							onClick={stop}
							disabled={interrupting}
							title="Stop Claude's current response. The session stays open — you can keep sending messages."
						>
							{interrupting ? "Stopping…" : "Stop"}
						</button>
					) : null}
					{!isOpen && session.sdkSessionId ? (
						<button
							className="btn"
							onClick={resume}
							disabled={resuming}
							title="Resume this session and keep talking with the same context."
						>
							{resuming ? "Resuming…" : "Resume"}
						</button>
					) : null}
					{session.diff ? (
						<Link to={`/sessions/${sessionId}/diff`} className="btn">
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
								<path
									d="M3 2h5v5M3 7l5-5"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
								/>
							</svg>
							View diff
						</Link>
					) : null}
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
					<StatusPill status={effectiveStatus} />
					<BranchChipWithDelta
						branch={session.branch}
						lastUserMessageBranch={session.lastUserMessageBranch}
						sessionId={sessionId}
						isWorktree={!!linkedWorktree}
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
							renderUnits.map((u) => {
								if (u.kind === "toolRun") {
									return <ToolRunGroup key={u.key} entries={u.entries} />;
								}
								return (
									<MessageView
										key={u.message.id}
										m={u.message}
										onFork={fork}
										forkPending={forkingId === u.message.id}
									/>
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

			{resumeError ? (
				<div
					className="message message-error"
					style={{ margin: 12, padding: 8, fontSize: 12 }}
				>
					{resumeError}
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

			{canChat ? (
				<ImagePasteTextarea
					sessionId={sessionId}
					textareaHeight={inputHeight}
					onContentHeightChange={onContentHeightChange}
					disabled={pending.length > 0}
					onSendOverride={
						isEphemeral
							? async (blocks) => {
								const textBlock = blocks.find(
									(b) => b.type === "text",
								);
								const imageBlocks = blocks.filter(
									(b) => b.type !== "text",
								);
								await promoteEphemeral({
									firstMessageText:
											textBlock?.type === "text"
												? textBlock.text
												: undefined,
									firstMessageImages:
											imageBlocks.length > 0
												? imageBlocks
												: undefined,
								});
							}
							: undefined
					}
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
				open={openFolderModal}
				title="Open folder in Finder?"
				message={
					<>
						Reveal{" "}
						<code style={{ fontFamily: T.mono, fontSize: 12 }}>
							{displayCwd}
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
							await navigator.clipboard.writeText(displayCwd);
						} catch {
							// noop — clipboard write can fail in some contexts
						}
						setOpenFolderModal(false);
					},
				}}
				onConfirm={() => {
					void window.claude.revealPath(displayCwd);
					setOpenFolderModal(false);
				}}
				onCancel={() => setOpenFolderModal(false)}
			/>

			<WorktreeLinkModal
				open={worktreeModalOpen && isEphemeral}
				cwd={ephemeralDraft?.cwd ?? ""}
				onPick={async (choice) => {
					await promoteEphemeral({ worktree: choice });
				}}
				onClose={() => setWorktreeModalOpen(false)}
			/>
		</div>
	);
}

/**
 * Inline chip sitting next to BranchChipWithDelta. Three visual states:
 *   - **Hidden** (real session, not linked) — returns null. There's no
 *     way to link a worktree to a real session after the SDK loop has
 *     spawned (see the v3 plan: cwd is baked into the SDK at spawn).
 *   - **Clickable** (`clickable=true`, ephemeral draft) — "Link worktree"
 *     action pill that opens the WorktreeLinkModal. Picking a worktree
 *     in the modal promotes the draft into a real session.
 *   - **Linked** (`linked` set) — locked info chip showing the worktree's
 *     branch name. Not clickable — links are immutable for a session's
 *     life.
 *
 * Mirrors the construction of `BranchChip` in Atoms.tsx (height 22, gap 6,
 * border radius 11, mono font) so the row visually homogenizes.
 */
function WorktreeChip({
	linked,
	clickable,
	onClick,
}: {
	linked: { branch: string; path: string; originalCwd: string } | undefined;
	/** True when the chip should render as the actionable "Link worktree"
	 * button — only on ephemeral drafts in the new design. */
	clickable: boolean;
	onClick: () => void;
}) {
	const isLinked = !!linked;

	// Hide entirely on real, unlinked sessions — there's no action they
	// could take and an empty chip is just visual noise.
	if (!isLinked && !clickable) return null;

	// No tooltip on this chip in any state — the label is self-explanatory.

	// Grey palette throughout — worktrees are app-info chrome, not a
	// status signal. Matches the rest of the app's neutral info chips.
	const bg = isLinked ? T.neutralSoft : T.surface;
	const border = isLinked ? T.neutralBorder : T.border;
	const color = isLinked ? T.neutral : T.textDim;

	return (
		<button
			type="button"
			onClick={isLinked ? undefined : onClick}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px 0 7px",
				borderRadius: 11,
				background: bg,
				border: `0.5px solid ${border}`,
				fontSize: 11.5,
				color,
				fontFamily: T.mono,
				whiteSpace: "nowrap",
				maxWidth: 200,
				overflow: "hidden",
				textOverflow: "ellipsis",
				cursor: isLinked ? "default" : "pointer",
				transition: "background 0.12s, color 0.12s, border-color 0.12s",
			}}
			onMouseEnter={(e) => {
				if (isLinked) return;
				e.currentTarget.style.background = T.surfaceHi;
				e.currentTarget.style.color = T.text;
			}}
			onMouseLeave={(e) => {
				if (isLinked) return;
				e.currentTarget.style.background = T.surface;
				e.currentTarget.style.color = T.textDim;
			}}
		>
			{/* Tree glyph: trunk + branches. Distinct enough from BranchChip's
			    commit-graph icon that the row reads at a glance. */}
			<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
				<path
					d="M6 10V2M6 5L3 3M6 5l3-2M6 8L3.5 6.5M6 8l2.5-1.5"
					stroke="currentColor"
					strokeWidth="1.1"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
				{isLinked ? linked!.branch : "Link worktree"}
			</span>
		</button>
	);
}

function ActivityChip({
	session,
	hasPending,
}: {
	session: { messages: { ts: number }[]; createdAt: number; status: string };
	hasPending: boolean;
}) {
	// Self-contained per-second tick so only this chip re-renders, not the
	// whole SessionChat tree (which would re-run react-markdown +
	// rehype-highlight for every message every second).
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, []);

	// Easter egg: click the chip to launch a tiny firework burst.
	const [bursts, setBursts] = useState<
		{
			id: number;
			particles: {
				tx: number;
				ty: number;
				color: string;
				size: number;
				delay: number;
				duration: number;
			}[];
		}[]
	>([]);
	const burstIdRef = useRef(0);
	const lastBurstAtRef = useRef(0);
	const handleFireworks = () => {
		const now = Date.now();
		if (now - lastBurstAtRef.current < 200) return; // throttle: ignore rapid re-clicks
		lastBurstAtRef.current = now;
		const id = ++burstIdRef.current;
		const palette = [
			"#ff6b9d",
			"#ffd166",
			"#06d6a0",
			"#4cc9f0",
			"#c77dff",
			"#ff9f43",
			"#ef476f",
		];
		const count = 14;
		const particles = Array.from({ length: count }, (_, i) => {
			// Even angular distribution with jitter
			const angle =
				(i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
			const distance = 32 + Math.random() * 32;
			return {
				tx: Math.cos(angle) * distance,
				ty: Math.sin(angle) * distance,
				color: palette[Math.floor(Math.random() * palette.length)],
				size: 3 + Math.random() * 2,
				delay: Math.random() * 60,
				duration: 750 + Math.random() * 350,
			};
		});
		setBursts((b) => [...b, { id, particles }]);
		window.setTimeout(() => {
			setBursts((b) => b.filter((x) => x.id !== id));
		}, 1300);
	};

	if (hasPending) return null;
	if (session.status === "idle") return null;

	const last =
		session.messages.length > 0
			? session.messages[session.messages.length - 1].ts
			: session.createdAt;
	const deltaSec = Math.max(0, Math.floor((Date.now() - last) / 1000));

	// Single muted neutral look — the active/quiet/stalled distinction is
	// just a wall-clock heuristic with no real liveness signal, so we drop it.
	const color = "oklch(0.55 0.008 70)";
	const border = "oklch(0.55 0.008 70 / 0.55)";
	const prefix = "working";

	return (
		<div
			onClick={handleFireworks}
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: T.surface,
				border: `0.5px solid ${border}`,
				color,
				fontSize: 11.5,
				fontFamily: T.mono,
				fontVariantNumeric: "tabular-nums",
				cursor: "pointer",
				userSelect: "none",
			}}
		>
			<span
				aria-hidden
				style={{
					display: "inline-block",
					width: 9,
					height: 9,
					border: "1.5px solid currentColor",
					borderRightColor: "transparent",
					borderRadius: "50%",
					animation: "asyncy-spin 0.9s linear infinite",
				}}
			/>
			{prefix} {formatDelta(deltaSec)}

			{bursts.map((b) =>
				b.particles.map((p, i) => (
					<span
						key={`${b.id}-${i}`}
						aria-hidden
						style={
							{
								position: "absolute",
								left: "50%",
								top: "50%",
								width: p.size,
								height: p.size,
								background: p.color,
								borderRadius: "50%",
								pointerEvents: "none",
								boxShadow: `0 0 6px ${p.color}`,
								animation: `firework-particle ${p.duration}ms cubic-bezier(0.18, 0.7, 0.3, 1) ${p.delay}ms forwards`,
								"--fx-tx": `${p.tx}px`,
								"--fx-ty": `${p.ty}px`,
							} as React.CSSProperties
						}
					/>
				)),
			)}
		</div>
	);
}

function formatDelta(sec: number): string {
	if (sec < 5) return "now";
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
