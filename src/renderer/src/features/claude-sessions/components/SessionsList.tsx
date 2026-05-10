import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import { BranchChip, StatusPill } from "../../../design/Atoms";
import { PermissionCard } from "./PermissionCard";
import type {
	ClaudeSessionFull,
	PermissionRequest,
	SessionMessage,
} from "@shared/claude-sessions/types";

const COLS = "1fr 200px 170px 32px";

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

	const sortedOrder = useMemo(() => {
		return [...order].sort(
			(a, b) => lastActivity(sessions[b]) - lastActivity(sessions[a]),
		);
	}, [order, sessions]);

	const lastUsedCwd = sortedOrder
		.map((id) => sessions[id]?.cwd)
		.find((c): c is string => !!c);

	const startWith = async (cwd: string) => {
		try {
			setStartError(null);
			const off = window.claude.on("session:started", (p) => {
				const s = p as { id: string };
				off();
				navigate(`/sessions/${s.id}`);
			});
			await window.claude.startSession({
				title: `Session ${order.length + 1}`,
				cwd,
			});
		} catch (err) {
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	const start = async () => {
		if (lastUsedCwd) {
			await startWith(lastUsedCwd);
			return;
		}
		const picked = await window.claude.pickFolder();
		if (picked) await startWith(picked);
	};

	const startInPickedFolder = async () => {
		const picked = await window.claude.pickFolder({
			defaultPath: lastUsedCwd,
		});
		if (picked) await startWith(picked);
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
					<button
						className="btn btn-primary"
						onClick={start}
						title={
							lastUsedCwd
								? `Start a session in ${lastUsedCwd}`
								: "Pick a folder and start a session there"
						}
					>
						<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
							<path
								d="M7 3v8M3 7h8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
						New Session
						{lastUsedCwd ? (
							<span
								style={{
									fontFamily: T.mono,
									fontSize: 11,
									opacity: 0.55,
									marginLeft: 2,
								}}
							>
								· {folderName(lastUsedCwd)}
							</span>
						) : null}
					</button>
					<FolderButton onClick={startInPickedFolder} />
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
						<div />
					</div>
					{sortedOrder.map((id, i) => {
						const s = sessions[id];
						const sessionPending = queue.filter((q) => q.sessionId === id);
						return (
							<Row
								key={id}
								session={s}
								last={i === sortedOrder.length - 1}
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
	const lastReadAt = useReadStore(
		(s) => s.lastReadAt[session.id] ?? 0,
	);
	const lastIncomingTs = lastIncomingMessageTs(session);
	const unread = lastIncomingTs > lastReadAt;
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
								fontWeight: unread ? 600 : 500,
								color: T.text,
								marginBottom: 3,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								display: "flex",
								alignItems: "center",
								gap: 8,
							}}
						>
							{unread ? (
								<span
									title="Unread"
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: T.accent,
										flexShrink: 0,
									}}
								/>
							) : null}
							<span
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{session.title}
							</span>
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
							{summary}
						</div>
						{session.cwd ? (
							<div
								title={session.cwd}
								style={{
									fontSize: 11,
									color: T.textFaint,
									fontFamily: T.mono,
									marginTop: 2,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{folderName(session.cwd)}
							</div>
						) : null}
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

function FolderButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			className="btn"
			onClick={onClick}
			title="Open a different folder and start a session there"
			style={{ width: 32, padding: 0, color: T.textDim }}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<path
					d="M1.5 3.5a1 1 0 011-1h2.4l1.2 1.4h5.4a1 1 0 011 1v5.6a1 1 0 01-1 1h-9a1 1 0 01-1-1v-7z"
					stroke="currentColor"
					strokeWidth="1.2"
					strokeLinejoin="round"
					fill="none"
				/>
			</svg>
		</button>
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

function folderName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const idx = trimmed.lastIndexOf("/");
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role === "assistant") return m.ts;
	}
	return 0;
}

function lastConversationMessage(
	session: ClaudeSessionFull,
): SessionMessage | undefined {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role === "user" || m.role === "assistant") return m;
	}
	return undefined;
}

function lastActivity(session: ClaudeSessionFull): number {
	const last = lastConversationMessage(session);
	return last?.ts ?? session.finishedAt ?? session.createdAt;
}

function deriveSummary(session: ClaudeSessionFull): string {
	if (session.error) return `Error: ${session.error}`;
	const last = lastConversationMessage(session);
	if (!last) {
		return session.status === "idle"
			? "Waiting for first message…"
			: "No messages yet.";
	}
	if (last.role === "assistant") {
		const text = extractAssistantText(last.content);
		if (text) return text.slice(0, 140);
		return "Working…";
	}
	const userText = extractUserText(last.content);
	if (userText) return `You: ${userText.slice(0, 140)}`;
	return "You sent a message.";
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

function extractUserText(content: unknown): string {
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

