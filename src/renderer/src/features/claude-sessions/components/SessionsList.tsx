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
	const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(
		null,
	);
	const [archiveError, setArchiveError] = useState<string | null>(null);
	const [archiving, setArchiving] = useState(false);
	const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
	// Non-persistent view toggle: when true, archived sessions are no longer
	// filtered out of the sidebar list (and their cwds appear in the
	// workspace filter). Resets to false on reload — mirrors how
	// workspaceFilter behaves.
	const [showArchived, setShowArchived] = useState(false);

	const sortedOrder = useMemo(() => {
		return [...order].sort((a, b) => {
			// Archived sessions sink to the bottom regardless of recency, so
			// the active list stays at eye level when "Show archived
			// sessions" is enabled. Within each group, newest first.
			const archivedA = sessions[a]?.archivedAt != null ? 1 : 0;
			const archivedB = sessions[b]?.archivedAt != null ? 1 : 0;
			if (archivedA !== archivedB) return archivedA - archivedB;
			return (sessions[b]?.createdAt ?? 0) - (sessions[a]?.createdAt ?? 0);
		});
	}, [order, sessions]);

	// Source of truth for "the workspace the user most recently created a
	// session in" is the app_settings store — it survives deleting every
	// session, which the derivation from `sessions` did not.
	const lastUsedCwd = useSettingsStore((s) => s.lastUsedWorkspace);

	const workspaces = useMemo(() => {
		const set = new Set<string>();
		for (const id of sortedOrder) {
			const s = sessions[id];
			if (!s) continue;
			// Archived sessions are invisible to the sidebar — that includes
			// the workspace filter dropdown. Once the user enables "Show
			// archived sessions", their cwds become eligible too so the
			// filter dropdown can target them.
			if (!showArchived && s.archivedAt != null) continue;
			if (s.cwd) set.add(s.cwd);
		}
		return Array.from(set).sort((a, b) =>
			folderName(a).localeCompare(folderName(b)),
		);
	}, [sortedOrder, sessions, showArchived]);

	// How many archived sessions exist anywhere. Drives whether to render
	// the view-options button when there's no workspace filter to anchor
	// the second header row.
	const archivedCount = useMemo(() => {
		let n = 0;
		for (const id of sortedOrder) {
			if (sessions[id]?.archivedAt != null) n++;
		}
		return n;
	}, [sortedOrder, sessions]);

	// Prune selected workspaces that no longer have any sessions (e.g. last
	// session in that workspace was deleted). Empty array means "All", so it's
	// fine to land there.
	useEffect(() => {
		if (workspaceFilter.length === 0) return;
		const valid = workspaceFilter.filter((w) => workspaces.includes(w));
		if (valid.length !== workspaceFilter.length) setWorkspaceFilter(valid);
	}, [workspaces, workspaceFilter]);

	const visibleOrder = useMemo(() => {
		const allowed =
			workspaceFilter.length > 0 ? new Set(workspaceFilter) : null;
		return sortedOrder.filter((id) => {
			const s = sessions[id];
			if (!s) return false;
			// Archive hides the row from the sidebar unless the user has
			// explicitly enabled "Show archived sessions". The session is
			// otherwise untouched (still in the store, still openable by
			// URL).
			if (!showArchived && s.archivedAt != null) return false;
			if (allowed) {
				if (s.cwd == null || !allowed.has(s.cwd)) return false;
			}
			return true;
		});
	}, [sortedOrder, sessions, workspaceFilter, showArchived]);

	// New-session target cwd: only use the filter when exactly one workspace is
	// selected (ambiguous otherwise). Otherwise fall back to last-used cwd.
	const targetCwd =
		workspaceFilter.length === 1
			? workspaceFilter[0]
			: lastUsedCwd ?? null;

	const startWith = async (cwd: string) => {
		// Subscribe before the IPC so we don't miss the `session:started`
		// broadcast. Captured in `off` so the error path can also tear it
		// down — previously this listener leaked any time startSession threw.
		let off: (() => void) | null = null;
		try {
			setStartError(null);
			// Remember this workspace for the next New Session click. Optimistic
			// local update + fire-and-forget IPC — mirrors the markRead pattern.
			// May be reconciled inside the `session:started` handler below if
			// the main process substituted a different cwd (missing-folder
			// recovery via the native picker).
			useSettingsStore.getState().setLastUsedWorkspace(cwd);
			off = window.claude.on("session:started", (p) => {
				const s = p as { id: string; cwd?: string };
				off?.();
				off = null;
				// Reconcile lastUsedWorkspace if the main process swapped the
				// cwd. We can't read the return value of startSession for
				// this — manager.run awaits the SDK loop, so its promise
				// doesn't resolve until the session ends. The session:started
				// event carries the same ClaudeSession payload and fires
				// immediately, so use it as the source of truth.
				if (s.cwd && s.cwd !== cwd) {
					useSettingsStore.getState().setLastUsedWorkspace(s.cwd);
				}
				// Make sure the newly-created session is actually visible. If
				// the user has narrowed the workspace filter and started a
				// session in a cwd that isn't selected, the session would
				// otherwise be hidden. Skip when the filter is empty ("All
				// workspaces") — every session is already visible.
				const resolvedCwd = s.cwd ?? cwd;
				setWorkspaceFilter((prev) =>
					prev.length === 0 || prev.includes(resolvedCwd)
						? prev
						: [...prev, resolvedCwd],
				);
				navigate(`/sessions/${s.id}`);
			});
			await window.claude.startSession({
				title: `Session ${order.length + 1}`,
				cwd,
			});
		} catch (err) {
			off?.();
			off = null;
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

	const confirmArchive = async () => {
		if (!pendingArchiveId || archiving) return;
		// Capture before the async work — pendingArchiveId may be cleared
		// by the time we want to make the routing decision.
		const wasActive = pendingArchiveId === activeSessionId;
		const targetId = pendingArchiveId;
		setArchiving(true);
		setArchiveError(null);
		try {
			await window.claude.archiveSession(targetId);
			// Intentionally do NOT call removeSession or
			// permissions.removeBySessionId here. Archive is reversible and
			// the session must remain in the renderer store so URL access
			// (`/sessions/:id`) still resolves. The main process broadcasts
			// a `session:patch` with `archivedAt`, which upserts the field
			// on the row; the sidebar's `visibleOrder` filter then hides
			// it.
			//
			// Mirror the backend's mark-read locally so the originating
			// window's AppNav unread count drops immediately. Main has
			// already persisted the same mark (monotonic), so this is a
			// no-op IPC on the persistence side but updates the in-memory
			// cache for this window.
			useReadStore.getState().markRead(targetId);
			// Backend also broadcasts `permission:resolved` for any
			// pending tool-use prompts it cancelled, which drains them
			// from the permissions store automatically — no local clear
			// needed.
			setPendingArchiveId(null);
			// Drop back to "/" if the archived session was the one open in
			// the right pane — there's no UI surface to find it again from
			// the sidebar after archiving (matches Delete's UX).
			if (wasActive) navigate("/");
		} catch (err) {
			setArchiveError(err instanceof Error ? err.message : String(err));
		} finally {
			setArchiving(false);
		}
	};

	const unarchive = async (sessionId: string) => {
		// No confirm modal — unarchive is benign (it just makes a hidden
		// row visible again) and acts as the "undo" affordance for an
		// accidental archive.
		try {
			await window.claude.unarchiveSession(sessionId);
		} catch (err) {
			// Surface failures the same way startError does so the user
			// isn't left wondering why nothing happened.
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	const cancelArchive = () => {
		if (archiving) return;
		setPendingArchiveId(null);
		setArchiveError(null);
	};

	const pendingArchiveSession = pendingArchiveId
		? sessions[pendingArchiveId]
		: null;

	const archiveModal = (
		<ConfirmModal
			open={!!pendingArchiveId}
			title="Archive session?"
			message={
				<>
					Hide{" "}
					<strong>
						{pendingArchiveSession?.title ?? "this session"}
					</strong>{" "}
					from the sidebar. The session is preserved and can be reopened
					by URL.
				</>
			}
			confirmLabel="Archive"
			cancelLabel="Cancel"
			busy={archiving}
			error={archiveError}
			onConfirm={confirmArchive}
			onCancel={cancelArchive}
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
						style={{ flex: 1, justifyContent: "center", minWidth: 0 }}
					>
						<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
							<path
								d="M7 3v8M3 7h8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
						<span style={{ flexShrink: 0 }}>New Session</span>
						{targetCwd ? (
							<>
								<span style={{ flexShrink: 0 }}>-</span>
								<span
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										minWidth: 0,
										flexShrink: 1,
									}}
								>
									{folderName(targetCwd)}
								</span>
							</>
						) : null}
					</button>
					<FolderButton onClick={startInPickedFolder} />
				</div>
				{workspaces.length > 0 || archivedCount > 0 ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						{workspaces.length > 0 ? (
							<div style={{ flex: 1, minWidth: 0 }}>
								<WorkspaceFilter
									workspaces={workspaces}
									value={workspaceFilter}
									onChange={setWorkspaceFilter}
									fullWidth
								/>
							</div>
						) : null}
						<ViewOptionsButton
							showArchived={showArchived}
							onToggleArchived={() =>
								setShowArchived((v) => !v)
							}
							alignRight={workspaces.length === 0}
						/>
					</div>
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

			{/* paddingBottom reserves dead space for the absolute-positioned
			    `SidebarFooter` so the last session row can be scrolled fully
			    into view instead of being clipped behind the footer. */}
			<div
				style={{
					flex: 1,
					overflowY: "auto",
					minHeight: 0,
					paddingBottom: 56,
				}}
			>
				{order.length === 0 ? (
					<div className="message" style={{ margin: 12 }}>
						No sessions yet. Click "New Session".
					</div>
				) : visibleOrder.length === 0 ? (
					<div className="message" style={{ margin: 12 }}>
						{workspaceFilter.length === 1 ? (
							<>
								No sessions in{" "}
								<code>{folderName(workspaceFilter[0])}</code>.{" "}
							</>
						) : (
							<>No sessions in the selected workspaces. </>
						)}
						<button
							type="button"
							onClick={() => setWorkspaceFilter([])}
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
									onArchive={() => {
										setPendingArchiveId(id);
										setArchiveError(null);
									}}
									onUnarchive={() => void unarchive(id)}
								/>
							);
						})}
					</div>
				)}
			</div>

			{deleteModal}
			{archiveModal}
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
	onArchive,
	onUnarchive,
}: {
	session: ClaudeSessionFull;
	last: boolean;
	pending: PermissionRequest[];
	active: boolean;
	onDelete: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
}) {
	const { hasPending, summary, unread } = useRowDerived(session, pending);
	const markUnread = useReadStore((s) => s.markUnread);
	const archived = session.archivedAt != null;
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				// Only highlight the active row. Pending state is conveyed by the
				// "waiting for input" StatusPill and the count badge below.
				background: active ? T.surfaceHi : "transparent",
				position: "relative",
				// Archived rows dim heavily so they read as "set aside"
				// against the active list. The full row dims — including
				// the ⋯ menu — but the button stays fully clickable. The
				// accent stripe on the active row also dims, which is
				// fine: archived sessions rarely sit in the active slot,
				// and when they do the dim acts as a useful "you're
				// viewing an archived session" cue.
				opacity: archived ? 0.4 : 1,
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
							onArchive={onArchive}
							onUnarchive={onUnarchive}
							archived={archived}
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
						{session.branch ? (
							<BranchChipWithDelta
								branch={session.branch}
								lastUserMessageBranch={session.lastUserMessageBranch}
								showCurrentHint={false}
								suppressStale
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
	value: string[];
	onChange: (v: string[]) => void;
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

	const label =
		value.length === 0
			? "All workspaces"
			: value.length === 1
				? folderName(value[0])
				: `${value.length} workspaces`;
	const labelMono = value.length === 1;

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
				title={
					value.length === 0
						? "Show sessions from all workspaces"
						: value.join("\n")
				}
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
						fontFamily: labelMono ? T.mono : undefined,
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
						active={value.length === 0}
						label="All workspaces"
						onClick={() => {
							onChange([]);
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
							active={value.includes(w)}
							label={folderName(w)}
							hint={w}
							mono
							checkbox
							onClick={() => {
								onChange(
									value.includes(w)
										? value.filter((v) => v !== w)
										: [...value, w],
								);
								// Stay open for multi-select toggling — outside-click
								// or Escape dismisses.
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
	checkbox,
	onClick,
}: {
	active: boolean;
	label: string;
	hint?: string;
	mono?: boolean;
	danger?: boolean;
	checkbox?: boolean;
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
				display: "flex",
				alignItems: "center",
				gap: 8,
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
			{checkbox ? (
				<span
					aria-hidden
					style={{
						width: 12,
						height: 12,
						borderRadius: 3,
						flexShrink: 0,
						border: `1.5px solid ${active ? T.accent : T.border}`,
						background: active ? T.accent : "transparent",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{active ? (
						<svg width="8" height="8" viewBox="0 0 8 8">
							<path
								d="M1.5 4l1.8 1.8L6.5 2.2"
								stroke={T.accentInk}
								strokeWidth="1.6"
								fill="none"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					) : null}
				</span>
			) : null}
			<span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
				{label}
			</span>
		</button>
	);
}

/**
 * Sidebar view-options dropdown. Visually a 32×32 icon button matching
 * FolderButton — stacks below it as the right-edge control of the second
 * header row, with the WorkspaceFilter taking the remaining width on the
 * left. Currently exposes one option: a toggle for "Show archived
 * sessions" / "Hide archived sessions". Sized as a dropdown rather than
 * an inline button so future view controls can land here without
 * crowding the header.
 *
 * `alignRight` pushes the button to the right edge when there's no
 * WorkspaceFilter sharing the row — keeps it stacked under FolderButton
 * regardless of what else is rendered.
 */
function ViewOptionsButton({
	showArchived,
	onToggleArchived,
	alignRight,
}: {
	showArchived: boolean;
	onToggleArchived: () => void;
	alignRight?: boolean;
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

	return (
		<div
			ref={ref}
			style={{
				position: "relative",
				marginLeft: alignRight ? "auto" : undefined,
			}}
		>
			<button
				type="button"
				className="btn"
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="menu"
				aria-expanded={open}
				title="View options"
				style={{ width: 32, padding: 0, color: T.textDim }}
			>
				{/* Eye icon — the only option today controls visibility. */}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path
						d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z"
						stroke="currentColor"
						strokeWidth="1.2"
						fill="none"
					/>
					<circle
						cx="7"
						cy="7"
						r="1.6"
						stroke="currentColor"
						strokeWidth="1.2"
						fill="none"
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
						minWidth: 200,
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 50,
						boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
					}}
				>
					<MenuItem
						active={false}
						label={
							showArchived
								? "Hide archived sessions"
								: "Show archived sessions"
						}
						onClick={() => {
							setOpen(false);
							onToggleArchived();
						}}
					/>
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
	onArchive,
	onUnarchive,
	archived,
	onMarkUnread,
	showMarkUnread,
}: {
	onDelete: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
	archived: boolean;
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
			style={{ position: "relative", display: "inline-flex", marginRight: -12 }}
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
					{archived ? (
						<MenuItem
							active={false}
							label="Unarchive"
							onClick={runAndClose(onUnarchive)}
						/>
					) : (
						<MenuItem
							active={false}
							label="Archive"
							onClick={runAndClose(onArchive)}
						/>
					)}
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
