import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
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

export function SessionChat({ sessionId }: { sessionId: string }) {
	const navigate = useNavigate();
	const session = useSessionsStore((s) => s.sessions[sessionId]);
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);
	const [interrupting, setInterrupting] = useState(false);
	const [forkingId, setForkingId] = useState<string | null>(null);
	const [forkError, setForkError] = useState<string | null>(null);
	const [pendingForkMessageId, setPendingForkMessageId] = useState<
		string | null
	>(null);
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
							title={`${session.cwd}\n(click to open in Finder)`}
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
					<StatusPill status={effectiveStatus} />
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
					onStop={stop}
					interrupting={interrupting}
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
