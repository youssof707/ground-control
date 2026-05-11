import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { T } from "../../../design/tokens";
import { BranchChipWithDelta, StatusPill } from "../../../design/Atoms";
import type {
	ClaudeSessionFull,
	PermissionRequest,
	SessionMessage,
} from "@shared/claude-sessions/types";

export function SessionsList({
	activeSessionId,
}: {
	activeSessionId?: string;
} = {}) {
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
		// Capture before the async work — pendingDeleteId may be cleared
		// by the time we want to make the routing decision.
		const wasActive = pendingDeleteId === activeSessionId;
		setDeleting(true);
		setDeleteError(null);
		try {
			await window.claude.deleteSession(pendingDeleteId);
			removeSession(pendingDeleteId);
			usePermissionsStore.getState().removeBySessionId(pendingDeleteId);
			setPendingDeleteId(null);
			// If the deleted session was the one currently open in the right
			// pane, drop back to "/" so the right pane goes empty — otherwise
			// SessionChat would render its "Session not found." state.
			if (wasActive) navigate("/");
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

	const deleteModal = (
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
	);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
			}}
		>
			{/* Compact header — drops the "Sessions" h1 + total Stat (the
			    AppNav already shows global counts), uses a stacked layout
			    instead of the wide page-header flexbox. */}
			<div
				style={{
					padding: "12px 12px 10px",
					borderBottom: `0.5px solid ${T.borderSoft}`,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
					<button
						className="btn btn-primary"
						onClick={start}
						title={
							targetCwd
								? `Start a session in ${targetCwd}`
								: "Pick a folder and start a session there"
						}
						style={{ flex: 1, justifyContent: "center" }}
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
					</button>
					<FolderButton onClick={startInPickedFolder} />
				</div>
				{workspaces.length > 0 ? (
					<WorkspaceFilter
						workspaces={workspaces}
						value={workspaceFilter}
						onChange={setWorkspaceFilter}
						fullWidth
					/>
				) : null}
			</div>

			{startError ? (
				<div
					className="message message-error"
					style={{ margin: 12, marginBottom: 0 }}
				>
					{startError}
				</div>
			) : null}

			<div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
				{order.length === 0 ? (
					<div className="message" style={{ margin: 12 }}>
						No sessions yet. Click "New Session".
					</div>
				) : visibleOrder.length === 0 ? (
					<div className="message" style={{ margin: 12 }}>
						No sessions in{" "}
						<code>
							{workspaceFilter ? folderName(workspaceFilter) : ""}
						</code>
						.{" "}
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
							Show all
						</button>
					</div>
				) : (
					<div>
						{visibleOrder.map((id, i) => {
							const s = sessions[id];
							const sessionPending = queue.filter(
								(q) => q.sessionId === id,
							);
							return (
								<SessionRowSidebar
									key={id}
									session={s}
									last={i === visibleOrder.length - 1}
									pending={sessionPending}
									active={id === activeSessionId}
									onDelete={() => {
										setPendingDeleteId(id);
										setDeleteError(null);
									}}
								/>
							);
						})}
					</div>
				)}
			</div>

			{deleteModal}
		</div>
	);
}

/**
 * Shared derivation used by SessionRowSidebar — keeps "unread", "pending",
 * and "summary" logic in one place.
 */
function useRowDerived(
	session: ClaudeSessionFull,
	pending: PermissionRequest[],
) {
	const hasPending = pending.length > 0;
	const summary = deriveSummary(session);
	const lastReadAt = useReadStore((s) => s.lastReadAt[session.id] ?? 0);
	const lastIncomingTs = lastIncomingMessageTs(session);
	const unread =
		session.status !== "running" && lastIncomingTs > lastReadAt;
	return {
		hasPending,
		summary,
		unread,
	};
}

function SessionRowSidebar({
	session,
	last,
	pending,
	active,
	onDelete,
}: {
	session: ClaudeSessionFull;
	last: boolean;
	pending: PermissionRequest[];
	active: boolean;
	onDelete: () => void;
}) {
	const { hasPending, summary, unread } = useRowDerived(session, pending);
	const markUnread = useReadStore((s) => s.markUnread);
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				// Only highlight the active row. Pending state is conveyed by the
				// "waiting for input" StatusPill and the count badge below.
				background: active ? T.surfaceHi : "transparent",
				position: "relative",
			}}
		>
			{active ? (
				<div
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						bottom: 0,
						width: 3,
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
						display: "flex",
						flexDirection: "column",
						gap: 6,
						padding: "12px 14px",
						minWidth: 0,
					}}
				>
					{/* Title row */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							minWidth: 0,
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
								flex: 1,
								minWidth: 0,
								fontSize: 13.5,
								fontWeight: unread ? 600 : 500,
								color: T.text,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{session.title}
						</span>
						<RowMenuButton
							onDelete={onDelete}
							onMarkUnread={() => markUnread(session.id)}
							showMarkUnread={!unread}
						/>
					</div>
					{/* Summary — two-line clamp */}
					<div
						style={{
							fontSize: 12,
							color: T.textMute,
							lineHeight: 1.35,
							display: "-webkit-box",
							WebkitLineClamp: 2,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}
					>
						{summary}
					</div>
					{/* Chips row */}
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							alignItems: "center",
							gap: 6,
							minWidth: 0,
						}}
					>
						<StatusPill
							status={hasPending ? "awaiting_permission" : session.status}
						/>
						{hasPending ? (
							<span
								title={`${pending.length} pending permission${pending.length === 1 ? "" : "s"}`}
								style={{
									fontSize: 10.5,
									fontWeight: 600,
									color: T.accent,
									background: T.accentSoft,
									border: `0.5px solid ${T.accentBorder}`,
									borderRadius: 4,
									padding: "1px 5px",
									letterSpacing: 0.3,
								}}
							>
								{pending.length} pending
							</span>
						) : null}
						{session.branch ? (
							<BranchChipWithDelta
								branch={session.branch}
								lastUserMessageBranch={session.lastUserMessageBranch}
								showCurrentHint={false}
							/>
						) : null}
					</div>
					{session.cwd ? (
						<div
							title={session.cwd}
							style={{
								fontSize: 11,
								color: T.textFaint,
								fontFamily: T.mono,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{folderName(session.cwd)}
						</div>
					) : null}
				</div>
			</Link>
		</div>
	);
}

function WorkspaceFilter({
	workspaces,
	value,
	onChange,
	fullWidth = false,
}: {
	workspaces: string[];
	value: string | null;
	onChange: (v: string | null) => void;
	fullWidth?: boolean;
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
		<div
			ref={ref}
			style={{
				position: "relative",
				width: fullWidth ? "100%" : undefined,
			}}
		>
			<button
				type="button"
				className="btn"
				onClick={() => setOpen((o) => !o)}
				title={value ?? "Show sessions from all workspaces"}
				style={{
					display: fullWidth ? "flex" : "inline-flex",
					width: fullWidth ? "100%" : undefined,
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
						left: fullWidth ? 0 : undefined,
						minWidth: fullWidth ? undefined : 220,
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
	danger,
	onClick,
}: {
	active: boolean;
	label: string;
	hint?: string;
	mono?: boolean;
	danger?: boolean;
	onClick: () => void;
}) {
	// Active wins over danger — workspace filter uses `active` to mark the
	// current selection, and that signal shouldn't be overridden by tone.
	const restingColor = active ? T.accent : danger ? T.danger : T.text;
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
				color: restingColor,
				fontSize: 13,
				fontFamily: mono ? T.mono : undefined,
				cursor: "pointer",
			}}
			onMouseEnter={(e) => {
				if (!active) {
					e.currentTarget.style.background = danger
						? T.dangerSoft
						: T.surface;
				}
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

/**
 * Row-level action menu. Replaces the old bare ✕ button so the row exposes
 * more than just "delete". Today: Delete + Mark as unread. The mark-unread
 * item is hidden when the row is already unread — keeps the menu showing
 * only actionable items.
 *
 * The row is wrapped in <Link>, so every click inside this menu has to
 * swallow propagation; otherwise opening the menu (or picking an item)
 * would navigate to the session. The wrapper div does this uniformly for
 * the button and every menu item.
 */
function RowMenuButton({
	onDelete,
	onMarkUnread,
	showMarkUnread,
}: {
	onDelete: () => void;
	onMarkUnread: () => void;
	showMarkUnread: boolean;
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

	const runAndClose = (fn: () => void) => () => {
		setOpen(false);
		fn();
	};

	return (
		<div
			ref={ref}
			onClick={(e) => {
				// Stop the row's <Link> from navigating on any click inside.
				e.preventDefault();
				e.stopPropagation();
			}}
			style={{ position: "relative", display: "inline-flex" }}
		>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="menu"
				aria-expanded={open}
				title="More actions"
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					border: "none",
					background: open ? T.surfaceHi : "transparent",
					color: open ? T.text : T.textFaint,
					cursor: "pointer",
					borderRadius: 4,
					padding: 0,
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = T.surfaceHi;
					e.currentTarget.style.color = T.text;
				}}
				onMouseLeave={(e) => {
					if (!open) {
						e.currentTarget.style.background = "transparent";
						e.currentTarget.style.color = T.textFaint;
					}
				}}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="currentColor"
					aria-hidden
				>
					<circle cx="7" cy="3" r="1.3" />
					<circle cx="7" cy="7" r="1.3" />
					<circle cx="7" cy="11" r="1.3" />
				</svg>
			</button>
			{open ? (
				<div
					role="menu"
					style={{
						position: "absolute",
						top: "calc(100% + 4px)",
						right: 0,
						minWidth: 160,
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 50,
						boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
					}}
				>
					{showMarkUnread ? (
						<MenuItem
							active={false}
							label="Mark as unread"
							onClick={runAndClose(onMarkUnread)}
						/>
					) : null}
					<MenuItem
						active={false}
						label="Delete"
						danger
						onClick={runAndClose(onDelete)}
					/>
				</div>
			) : null}
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
