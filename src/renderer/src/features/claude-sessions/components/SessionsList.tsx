import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { useMinimizedPermissionsStore } from "../stores/useMinimizedPermissionsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import {
	BranchChipWithDelta,
	MinimizeToggle,
	StatusPill,
} from "../../../design/Atoms";
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
	const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);

	const sortedOrder = useMemo(() => {
		return [...order].sort(
			(a, b) =>
				(sessions[b]?.createdAt ?? 0) - (sessions[a]?.createdAt ?? 0),
		);
	}, [order, sessions]);

	// Source of truth for "the workspace the user most recently created a
	// session in" is the app_settings store — it survives deleting every
	// session, which the derivation from `sessions` did not.
	const lastUsedCwd = useSettingsStore((s) => s.lastUsedWorkspace);

	const workspaces = useMemo(() => {
		const set = new Set<string>();
		for (const id of sortedOrder) {
			const c = sessions[id]?.cwd;
			if (c) set.add(c);
		}
		return Array.from(set).sort((a, b) =>
			folderName(a).localeCompare(folderName(b)),
		);
	}, [sortedOrder, sessions]);

	// If the active filter no longer matches any session (e.g. last session in
	// that workspace was deleted), fall back to ALL.
	useEffect(() => {
		if (workspaceFilter && !workspaces.includes(workspaceFilter)) {
			setWorkspaceFilter(null);
		}
	}, [workspaces, workspaceFilter]);

	const visibleOrder = useMemo(() => {
		if (!workspaceFilter) return sortedOrder;
		return sortedOrder.filter((id) => sessions[id]?.cwd === workspaceFilter);
	}, [sortedOrder, sessions, workspaceFilter]);

	// New-session target cwd: filter takes precedence, then last-used cwd.
	const targetCwd = workspaceFilter ?? lastUsedCwd ?? null;

	const startWith = async (cwd: string) => {
		try {
			setStartError(null);
			// Remember this workspace for the next New Session click. Optimistic
			// local update + fire-and-forget IPC — mirrors the markRead pattern.
			useSettingsStore.getState().setLastUsedWorkspace(cwd);
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
		if (targetCwd) {
			await startWith(targetCwd);
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
			usePermissionsStore.getState().removeBySessionId(pendingDeleteId);
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
					</div>
				</div>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					{workspaces.length > 0 ? (
						<WorkspaceFilter
							workspaces={workspaces}
							value={workspaceFilter}
							onChange={setWorkspaceFilter}
						/>
					) : null}
					<button
						className="btn btn-primary"
						onClick={start}
						title={
							targetCwd
								? `Start a session in ${targetCwd}`
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
						{targetCwd ? (
							<span
								style={{
									fontFamily: T.mono,
									fontSize: 11,
									opacity: 0.55,
									marginLeft: 2,
								}}
							>
								· {folderName(targetCwd)}
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
			) : visibleOrder.length === 0 ? (
				<div className="message">
					No sessions in{" "}
					<code>{workspaceFilter ? folderName(workspaceFilter) : ""}</code>.
					Switch the filter to{" "}
					<button
						type="button"
						onClick={() => setWorkspaceFilter(null)}
						style={{
							border: "none",
							background: "transparent",
							padding: 0,
							color: T.accent,
							cursor: "pointer",
							font: "inherit",
							textDecoration: "underline",
						}}
					>
						All workspaces
					</button>
					.
				</div>
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
					{visibleOrder.map((id, i) => {
						const s = sessions[id];
						const sessionPending = queue.filter((q) => q.sessionId === id);
						return (
							<Row
								key={id}
								session={s}
								last={i === visibleOrder.length - 1}
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
	const hasPending = pending.length > 0;
	const minimized = useMinimizedPermissionsStore(
		(s) => s.minimized[session.id] ?? false,
	);
	const setMinimized = useMinimizedPermissionsStore((s) => s.setMinimized);
	const expanded = hasPending && !minimized;
	const summary = deriveSummary(session);
	const lastReadAt = useReadStore(
		(s) => s.lastReadAt[session.id] ?? 0,
	);
	const lastIncomingTs = lastIncomingMessageTs(session);
	const unread =
		session.status !== "running" && lastIncomingTs > lastReadAt;
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				// Keep the accent treatment whenever there's something pending,
				// regardless of whether the cards themselves are visible — so a
				// minimized row still reads as "has a pending request" at a glance.
				background: hasPending ? T.accentSoft : "transparent",
				position: "relative",
			}}
		>
			{hasPending ? (
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
							<BranchChipWithDelta
								branch={session.branch}
								lastUserMessageBranch={session.lastUserMessageBranch}
								showCurrentHint={false}
							/>
						) : (
							<span style={{ color: T.textFaint, fontSize: 12 }}>—</span>
						)}
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							minWidth: 0,
						}}
					>
						<StatusPill
							status={
								hasPending ? "awaiting_permission" : session.status
							}
						/>
						{hasPending ? (
							<MinimizeToggle
								minimized={minimized}
								onToggle={() => setMinimized(session.id, !minimized)}
								count={pending.length}
							/>
						) : null}
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

function WorkspaceFilter({
	workspaces,
	value,
	onChange,
}: {
	workspaces: string[];
	value: string | null;
	onChange: (v: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const label = value ? folderName(value) : "All workspaces";

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				className="btn"
				onClick={() => setOpen((o) => !o)}
				title={value ?? "Show sessions from all workspaces"}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 8,
					color: T.textDim,
					fontSize: 13,
				}}
			>
				<span
					style={{
						color: T.textMute,
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: 1,
						textTransform: "uppercase",
					}}
				>
					Workspace
				</span>
				<span
					style={{
						color: T.text,
						fontFamily: value ? T.mono : undefined,
					}}
				>
					{label}
				</span>
				<svg width="9" height="9" viewBox="0 0 10 10">
					<path
						d="M2 4l3 3 3-3"
						stroke="currentColor"
						strokeWidth="1.4"
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			{open ? (
				<div
					role="menu"
					style={{
						position: "absolute",
						top: "calc(100% + 4px)",
						right: 0,
						minWidth: 220,
						maxHeight: 320,
						overflowY: "auto",
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 50,
						boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
					}}
				>
					<MenuItem
						active={value === null}
						label="All workspaces"
						onClick={() => {
							onChange(null);
							setOpen(false);
						}}
					/>
					{workspaces.length > 0 ? (
						<div
							style={{
								height: 1,
								background: T.borderSoft,
								margin: "4px 0",
							}}
						/>
					) : null}
					{workspaces.map((w) => (
						<MenuItem
							key={w}
							active={value === w}
							label={folderName(w)}
							hint={w}
							mono
							onClick={() => {
								onChange(w);
								setOpen(false);
							}}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function MenuItem({
	active,
	label,
	hint,
	mono,
	onClick,
}: {
	active: boolean;
	label: string;
	hint?: string;
	mono?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			title={hint}
			style={{
				display: "block",
				width: "100%",
				textAlign: "left",
				padding: "6px 10px",
				borderRadius: 6,
				border: "none",
				background: active ? T.accentSoft : "transparent",
				color: active ? T.accent : T.text,
				fontSize: 13,
				fontFamily: mono ? T.mono : undefined,
				cursor: "pointer",
			}}
			onMouseEnter={(e) => {
				if (!active) e.currentTarget.style.background = T.surface;
			}}
			onMouseLeave={(e) => {
				if (!active) e.currentTarget.style.background = "transparent";
			}}
		>
			{label}
		</button>
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

