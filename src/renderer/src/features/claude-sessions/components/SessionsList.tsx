import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import { BranchChip, Eyebrow, StatusPill } from "../../../design/Atoms";
import { PermissionCard } from "./PermissionCard";
import type {
	ClaudeSessionFull,
	PermissionRequest,
} from "@shared/claude-sessions/types";

// EDIT ME: absolute path to a real repo with a .git directory and source files.
const TEST_CWD = "/Users/youssof/Working Files/Code/gamestudio";

const COLS = "1fr 200px 170px 120px 32px";

export function SessionsList() {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const removeSession = useSessionsStore((s) => s.removeSession);
	const queue = usePermissionsStore((s) => s.queue);
	const navigate = useNavigate();
	const [startError, setStartError] = useState<string | null>(null);

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	const runningCount = order.filter(
		(id) => sessions[id].status === "running",
	).length;
	const waitingCount = new Set(queue.map((q) => q.sessionId)).size;

	const start = async () => {
		try {
			setStartError(null);
			const off = window.claude.on("session:started", (p) => {
				const s = p as { id: string };
				off();
				navigate(`/sessions/${s.id}`);
			});
			await window.claude.startSession({
				title: `Session ${order.length + 1}`,
				cwd: TEST_CWD,
			});
		} catch (err) {
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	const confirmDelete = async () => {
		if (!pendingDeleteId || deleting) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await window.claude.deleteSession(pendingDeleteId);
			removeSession(pendingDeleteId);
			setPendingDeleteId(null);
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeleting(false);
		}
	};

	const cancelDelete = () => {
		if (deleting) return;
		setPendingDeleteId(null);
		setDeleteError(null);
	};

	const pendingDeleteSession = pendingDeleteId
		? sessions[pendingDeleteId]
		: null;

	return (
		<div className="page">
			{/* Header */}
			<div className="page-header">
				<div>
					<Eyebrow style={{ marginBottom: 6 }}>Workspace · {TEST_CWD}</Eyebrow>
					<h1 className="page-title">Sessions</h1>
					<div
						style={{
							display: "flex",
							gap: 14,
							alignItems: "center",
							fontSize: 13,
							color: T.textDim,
						}}
					>
						<Stat n={order.length} label="total" />
						<Sep />
						<Stat n={runningCount} label="running" dot={T.ok} />
						<Sep />
						<Stat n={waitingCount} label="waiting" dot={T.accent} />
					</div>
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button className="btn btn-primary" onClick={start}>
						<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
							<path
								d="M7 3v8M3 7h8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
						New Session
					</button>
				</div>
			</div>

			{startError ? (
				<div className="message message-error" style={{ marginBottom: 16 }}>
					{startError}
				</div>
			) : null}

			{order.length === 0 ? (
				<div className="message">No sessions yet. Click “New Session”.</div>
			) : (
				<div
					style={{
						borderRadius: 12,
						overflow: "hidden",
						border: `0.5px solid ${T.border}`,
						background: T.surface,
					}}
				>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: COLS,
							padding: "11px 18px",
							borderBottom: `0.5px solid ${T.border}`,
							fontSize: 11,
							fontWeight: 600,
							color: T.textMute,
							letterSpacing: 1,
							textTransform: "uppercase",
						}}
					>
						<div>Session</div>
						<div>Branch</div>
						<div>Status</div>
						<div>ID</div>
						<div />
					</div>
					{order.map((id, i) => {
						const s = sessions[id];
						const sessionPending = queue.filter((q) => q.sessionId === id);
						return (
							<Row
								key={id}
								session={s}
								last={i === order.length - 1}
								pending={sessionPending}
								onDelete={() => {
									setPendingDeleteId(id);
									setDeleteError(null);
								}}
							/>
						);
					})}
				</div>
			)}

			<ConfirmModal
				open={!!pendingDeleteId}
				title="Delete session?"
				message={
					<>
						Remove <strong>{pendingDeleteSession?.title ?? "this session"}</strong>{" "}
						from this app. Claude Code's own session history (in{" "}
						<code>~/.claude</code>) is not affected.
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

function Row({
	session,
	last,
	pending,
	onDelete,
}: {
	session: ClaudeSessionFull;
	last: boolean;
	pending: PermissionRequest[];
	onDelete: () => void;
}) {
	const expanded = pending.length > 0;
	const summary = deriveSummary(session);
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				background: expanded ? T.accentSoft : "transparent",
				position: "relative",
			}}
		>
			{expanded ? (
				<div
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						bottom: 0,
						width: 2,
						background: T.accent,
					}}
				/>
			) : null}
			<Link
				to={`/sessions/${session.id}`}
				style={{ textDecoration: "none", color: "inherit" }}
			>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: COLS,
						padding: "14px 18px",
						alignItems: "center",
					}}
				>
					<div style={{ minWidth: 0 }}>
						<div
							style={{
								fontSize: 13.5,
								fontWeight: 500,
								color: T.text,
								marginBottom: 3,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{session.title}
						</div>
						<div
							style={{
								fontSize: 12,
								color: T.textMute,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							<span style={{ color: T.textFaint, marginRight: 8 }}>
								{relativeTime(
									session.finishedAt ?? session.createdAt,
								)}
							</span>
							{summary}
						</div>
					</div>
					<div>
						{session.branch ? (
							<BranchChip name={session.branch} />
						) : (
							<span style={{ color: T.textFaint, fontSize: 12 }}>—</span>
						)}
					</div>
					<div>
						<StatusPill
							status={
								pending.length > 0 ? "awaiting_permission" : session.status
							}
						/>
					</div>
					<div
						style={{
							fontFamily: T.mono,
							fontSize: 12,
							color: T.textMute,
						}}
					>
						{session.id.slice(0, 8)}
					</div>
					<DeleteButton onClick={onDelete} />
				</div>
			</Link>
			{expanded ? (
				<div style={{ margin: "0 18px 16px 18px" }}>
					{pending.map((p) => (
						<PermissionCard key={p.requestId} req={p} />
					))}
				</div>
			) : null}
		</div>
	);
}

function DeleteButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			}}
			title="Delete this session from the app"
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 24,
				height: 24,
				border: "none",
				background: "transparent",
				color: T.textFaint,
				cursor: "pointer",
				borderRadius: 4,
				fontSize: 14,
				lineHeight: 1,
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = T.dangerSoft;
				e.currentTarget.style.color = T.danger;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
				e.currentTarget.style.color = T.textFaint;
			}}
		>
			✕
		</button>
	);
}

function Stat({ n, label, dot }: { n: number; label: string; dot?: string }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			{dot ? (
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: dot,
					}}
				/>
			) : null}
			<span
				style={{
					fontFamily: T.mono,
					color: T.text,
					fontWeight: 500,
				}}
			>
				{n}
			</span>
			<span style={{ color: T.textMute }}>{label}</span>
		</div>
	);
}

function Sep() {
	return (
		<span
			style={{
				width: 3,
				height: 3,
				borderRadius: "50%",
				background: T.border,
			}}
		/>
	);
}

function deriveSummary(session: ClaudeSessionFull): string {
	const last = session.messages[session.messages.length - 1];
	if (!last) {
		return session.status === "idle"
			? "Waiting for first message…"
			: "No messages yet.";
	}
	if (session.error) return `Error: ${session.error}`;
	if (last.role === "assistant") {
		const text = extractAssistantText(last.content);
		if (text) return text.slice(0, 140);
	}
	if (last.role === "user") return "You sent a message.";
	if (last.role === "result") return "Turn ended.";
	return "Working…";
}

function extractAssistantText(content: unknown): string {
	const blocks = (
		content as { message?: { content?: { type?: string; text?: string }[] } }
	)?.message?.content;
	if (!Array.isArray(blocks)) return "";
	for (const b of blocks) {
		if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
			return b.text.replace(/\s+/g, " ").trim();
		}
	}
	return "";
}

function relativeTime(ts: number): string {
	const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (sec < 30) return "just now";
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
	return `${Math.floor(sec / 86400)}d ago`;
}
