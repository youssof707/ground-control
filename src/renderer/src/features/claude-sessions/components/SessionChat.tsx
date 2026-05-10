import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { PermissionCard } from "./PermissionCard";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { MessageView } from "./MessageView";
import { T } from "../../../design/tokens";
import { BranchChip, StatusPill } from "../../../design/Atoms";

export function SessionChat({ sessionId }: { sessionId: string }) {
	const navigate = useNavigate();
	const session = useSessionsStore((s) => s.sessions[sessionId]);
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	const removeSession = useSessionsStore((s) => s.removeSession);
	const allSessions = useSessionsStore((s) => s.sessions);
	const sessionOrder = useSessionsStore((s) => s.order);
	const lastReadAt = useReadStore((s) => s.lastReadAt);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);
	const hasAnyUnread = sessionOrder.some((id) => {
		const sess = allSessions[id];
		if (!sess) return false;
		if (sess.status === "running") return false;
		let lastIncoming = 0;
		for (let i = sess.messages.length - 1; i >= 0; i--) {
			if (sess.messages[i].role === "assistant") {
				lastIncoming = sess.messages[i].ts;
				break;
			}
		}
		return lastIncoming > 0 && lastIncoming > (lastReadAt[id] ?? 0);
	});
	const [interrupting, setInterrupting] = useState(false);
	const [resuming, setResuming] = useState(false);
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const titleInputRef = useRef<HTMLInputElement>(null);
	const [pendingDelete, setPendingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const isOpen =
		session?.status === "running" ||
		session?.status === "idle" ||
		session?.status === "awaiting_permission";
	const canChat = isOpen || !!session?.sdkSessionId;

	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const messageCount = session?.messages.length ?? 0;
	const pendingCount = pending.length;

	const [, setTick] = useState(0);
	useEffect(() => {
		if (!isOpen) return;
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [isOpen]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !stickToBottom.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messageCount, pendingCount]);

	useEffect(() => {
		useReadStore.getState().markRead(sessionId);
	}, [sessionId, messageCount, pendingCount]);

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

	const requestDelete = () => {
		setDeleteError(null);
		setPendingDelete(true);
	};

	const confirmDelete = async () => {
		if (deleting) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await window.claude.deleteSession(sessionId);
			removeSession(sessionId);
			setPendingDelete(false);
			navigate("/");
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeleting(false);
		}
	};

	const cancelDelete = () => {
		if (deleting) return;
		setPendingDelete(false);
		setDeleteError(null);
	};

	// Clicking the "Sessions" breadcrumb (back). If this session has never
	// received a message, treat it as discarded scratch space and delete it
	// on the way out rather than leaving an empty husk in the list.
	const handleLeave = async (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		if (session && session.messages.length === 0) {
			try {
				await window.claude.deleteSession(sessionId);
				removeSession(sessionId);
			} catch (err) {
				// If the cleanup fails, fall through and navigate anyway —
				// stranding the user on this screen would be worse than
				// leaving an empty session behind.
				console.error("Failed to delete empty session on leave", err);
			}
		}
		navigate("/");
	};

	if (!session) {
		return (
			<div className="page">
				<div className="message">Session not found.</div>
				<div style={{ marginTop: 12 }}>
					<Link to="/">← Back</Link>
				</div>
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
				{/* Row 1: back, title, filepath, action buttons */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 14,
						minWidth: 0,
					}}
				>
					<Link
						to="/"
						onClick={handleLeave}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontSize: 12.5,
							color: T.textDim,
							textDecoration: "none",
							padding: "5px 9px",
							borderRadius: 7,
							border: `0.5px solid ${T.border}`,
							flexShrink: 0,
						}}
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path
								d="M7 3l-3 3 3 3"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						Sessions
						{hasAnyUnread ? (
							<span
								title="Unread sessions"
								style={{
									width: 7,
									height: 7,
									borderRadius: "50%",
									background: T.accent,
									flexShrink: 0,
								}}
							/>
						) : null}
					</Link>
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
						<span
							title={session.cwd}
							style={{
								fontFamily: T.mono,
								fontSize: 11.5,
								color: T.textFaint,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								minWidth: 0,
								flex: 1,
							}}
						>
							{session.cwd}
						</span>
					) : (
						<div style={{ flex: 1 }} />
					)}

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
					<button
						className="btn btn-destructive"
						onClick={requestDelete}
						disabled={deleting}
						title="Delete this session from the app."
					>
						{deleting ? "Deleting…" : "Delete session"}
					</button>
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

				{/* Row 2: id + status chips */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						flexWrap: "wrap",
					}}
				>
					<span
						style={{
							fontFamily: T.mono,
							fontSize: 11.5,
							color: T.textFaint,
						}}
					>
						{session.id.slice(0, 8)}
					</span>
					<StatusPill status={effectiveStatus} />
					{session.branch ? <BranchChip name={session.branch} /> : null}
					{isOpen ? (
						<ActivityChip session={session} hasPending={pending.length > 0} />
					) : null}
				</div>
			</div>

			{/* Transcript */}
			<div
				ref={scrollRef}
				onScroll={onScroll}
				style={{
					flex: 1,
					overflow: "auto",
					padding: "28px 0 18px",
					minHeight: 0,
				}}
			>
				<div style={{ maxWidth: 760, margin: "0 auto", padding: "0 32px" }}>
					{session.messages.length === 0 && pending.length === 0 ? (
						<div className="message">Waiting for first message…</div>
					) : (
						session.messages.map((m) => <MessageView key={m.id} m={m} />)
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

			{resumeError ? (
				<div
					className="message message-error"
					style={{ margin: 12, padding: 8, fontSize: 12 }}
				>
					{resumeError}
				</div>
			) : null}

			{canChat ? <ImagePasteTextarea sessionId={sessionId} /> : null}

			<ConfirmModal
				open={pendingDelete}
				title="Delete session?"
				message={
					<>
						Remove <strong>{session.title}</strong> from this app. Claude Code's
						own session history (in <code>~/.claude</code>) is not affected.
					</>
				}
				confirmLabel="Delete"
				cancelLabel="Cancel"
				destructive
				busy={deleting}
				error={deleteError}
				onConfirm={confirmDelete}
				onCancel={cancelDelete}
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
	if (hasPending) return null;
	if (session.status === "idle") return null;

	const last =
		session.messages.length > 0
			? session.messages[session.messages.length - 1].ts
			: session.createdAt;
	const deltaSec = Math.max(0, Math.floor((Date.now() - last) / 1000));

	let color: string = T.ok;
	let bg: string = T.okSoft;
	let prefix = "active";
	if (deltaSec >= 120) {
		color = T.danger;
		bg = T.dangerSoft;
		prefix = "stalled";
	} else if (deltaSec >= 30) {
		color = T.neutral;
		bg = T.neutralSoft;
		prefix = "quiet";
	}

	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: bg,
				border: `0.5px solid ${color}`,
				color,
				fontSize: 11.5,
				fontFamily: T.mono,
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{prefix} {formatDelta(deltaSec)}
		</div>
	);
}

function formatDelta(sec: number): string {
	if (sec < 5) return "now";
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
