import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
	useDraftSessionsStore,
	type DraftSession,
} from "../stores/useDraftSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { AddToGroupModal } from "./AddToGroupModal";
import { RenameGroupModal } from "./RenameGroupModal";
import { T } from "../../../design/tokens";
import { BranchChipWithDelta, StatusPill } from "../../../design/Atoms";
import { WorktreeChip, WORKTREE_COLOR_MAP } from "../../../design/WorktreeChip";
import type {
	ClaudeSessionFull,
	PermissionRequest,
	SessionMessage,
} from "@shared/claude-sessions/types";
import {
	interruptMarkerText,
	isConversationSkipped,
} from "@shared/claude-sessions/transcript";
import type { SessionGroup } from "@shared/schemas/session_groups";

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
	// Opt-in cascade: when the pending-delete session is the sole
	// occupant of its worktree, the modal renders a checkbox that
	// enables `worktrees:delete` right after the session goes away.
	// Reset on cancel / on each fresh open so a stale check can't leak
	// across two consecutive deletes.
	const [alsoDeleteWorktree, setAlsoDeleteWorktree] = useState(false);
	const worktrees = useWorktreesStore((s) => s.worktrees);
	const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(
		null,
	);
	const [archiveError, setArchiveError] = useState<string | null>(null);
	const [archiving, setArchiving] = useState(false);
	// Session currently picking a group in the AddToGroupModal. Mirrors the
	// pendingDeleteId / pendingArchiveId pattern above; null = closed.
	const [pendingGroupSessionId, setPendingGroupSessionId] = useState<
		string | null
	>(null);
	// Group currently being renamed via RenameGroupModal. Same null-sentinel
	// pattern as pendingGroupSessionId; opened from the group header's
	// right-click context menu.
	const [pendingRenameGroupId, setPendingRenameGroupId] = useState<
		string | null
	>(null);
	const groups = useSessionGroupsStore((s) => s.groups);
	// Whole map (not per-row selector): needed to compute aggregate unread
	// counts for collapsed group headers without calling hooks in a loop.
	const lastReadAtMap = useReadStore((s) => s.lastReadAt);
	const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
	// Non-persistent view toggle: when true, archived sessions are no longer
	// filtered out of the sidebar list (and their cwds appear in the
	// workspace filter). Resets to false on reload — mirrors how
	// workspaceFilter behaves.
	const [showArchived, setShowArchived] = useState(false);
	// Collapsed cwd buckets (ungrouped section). Non-persistent view state —
	// resets on reload, mirroring workspaceFilter / showArchived above.
	const [collapsedCwds, setCollapsedCwds] = useState<Set<string>>(
		() => new Set(),
	);
	const toggleCwdCollapsed = (cwd: string) => {
		setCollapsedCwds((prev) => {
			const next = new Set(prev);
			if (next.has(cwd)) next.delete(cwd);
			else next.add(cwd);
			return next;
		});
	};

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

	// Partition the visible rows into "ungrouped" (rendered first, bucketed
	// by cwd under subtle headers) and per-group sections (rendered after,
	// newest group first). Built from `visibleOrder`, so:
	//   - intra-bucket / intra-group ordering matches the flat list's
	//     comparator exactly (newest first; archived sink within their
	//     bucket — the per-bucket analogue of the global convention above);
	//   - a group whose members are all filtered out (workspace filter,
	//     archived-hidden) never materializes a section → hidden, per spec;
	//   - a dangling groupId (group record missing — crash window, stale
	//     cache) degrades to "ungrouped" instead of vanishing the row.
	const { ungroupedBuckets, groupSections } = useMemo(() => {
		const byCwd = new Map<string, string[]>();
		const byGroup = new Map<string, string[]>();
		for (const id of visibleOrder) {
			const gid = sessions[id]?.groupId;
			if (gid && groups[gid]) {
				const list = byGroup.get(gid);
				if (list) list.push(id);
				else byGroup.set(gid, [id]);
			} else {
				const cwd = sessions[id]?.cwd ?? "";
				const list = byCwd.get(cwd);
				if (list) list.push(id);
				else byCwd.set(cwd, [id]);
			}
		}
		const buckets = Array.from(byCwd.entries())
			.map(([cwd, ids]) => ({ cwd, ids }))
			// Alphabetical by folder name (matches the workspace dropdown);
			// full-cwd tie-break keeps same-basename dirs deterministic.
			.sort(
				(a, b) =>
					folderName(a.cwd).localeCompare(folderName(b.cwd)) ||
					a.cwd.localeCompare(b.cwd),
			);
		const sections = Array.from(byGroup.entries())
			.map(([gid, ids]) => ({ group: groups[gid], ids }))
			// Newest group first; ulid tie-break keeps same-ms creates stable.
			.sort(
				(a, b) =>
					b.group.createdAt - a.group.createdAt ||
					b.group.id.localeCompare(a.group.id),
			);
		return { ungroupedBuckets: buckets, groupSections: sections };
	}, [visibleOrder, sessions, groups]);

	// New-session target cwd: only use the filter when exactly one workspace is
	// selected (ambiguous otherwise). Otherwise fall back to last-used cwd.
	const targetCwd =
		workspaceFilter.length === 1
			? workspaceFilter[0]
			: lastUsedCwd ?? null;

	// Single-slot draft (the UI-only session that exists before the first
	// message). Both New Session affordances short-circuit to navigate into
	// the existing draft when one is open — per the "reuse, don't replace"
	// decision. The real session is created later by `ImagePasteTextarea.send`
	// on the first user message, which also handles cwd reconciliation via
	// the `session:started` broadcast.
	const draft = useDraftSessionsStore((s) => s.draft);

	const createDraftAndNavigate = (cwd: string) => {
		// Remember the workspace immediately so the next New Session click
		// pre-fills the same folder (parity with the old IPC-direct flow).
		// If the main process later substitutes a different cwd at first send
		// (missing-folder recovery picker), the bootstrap listener for
		// `session:started` already reconciles the store from the broadcast.
		useSettingsStore.getState().setLastUsedWorkspace(cwd);
		const d = useDraftSessionsStore.getState().createDraft({
			cwd,
			defaultTitle: `Session ${order.length + 1}`,
		});
		// Make sure the new draft is actually visible. If the user has narrowed
		// the workspace filter and the draft cwd isn't in it, the draft row
		// would render but the future real session would be hidden after send.
		// Adding cwd up-front matches the old startWith() behavior so the row
		// transition is seamless.
		setWorkspaceFilter((prev) =>
			prev.length === 0 || prev.includes(cwd) ? prev : [...prev, cwd],
		);
		navigate(`/sessions/${d.id}`);
	};

	const start = async () => {
		if (draft) {
			navigate(`/sessions/${draft.id}`);
			return;
		}
		setStartError(null);
		if (targetCwd) {
			createDraftAndNavigate(targetCwd);
			return;
		}
		const picked = await window.claude.pickFolder();
		if (picked) createDraftAndNavigate(picked);
	};

	const startInPickedFolder = async () => {
		if (draft) {
			navigate(`/sessions/${draft.id}`);
			return;
		}
		setStartError(null);
		const picked = await window.claude.pickFolder({
			defaultPath: lastUsedCwd,
		});
		if (picked) createDraftAndNavigate(picked);
	};

	const discardDraft = (id: string) => {
		const wasActive = id === activeSessionId;
		useDraftStore.getState().clearDraft(id);
		useDraftSessionsStore.getState().discardDraft();
		if (wasActive) navigate("/");
	};

	const pendingDeleteSession = pendingDeleteId
		? sessions[pendingDeleteId]
		: null;

	// Worktree attached to the session about to be deleted (if any).
	// Drives both the "Also delete worktree" checkbox visibility and
	// the cascade in confirmDelete.
	const pendingDeleteWorktree =
		pendingDeleteSession?.worktreeId
			? worktrees[pendingDeleteSession.worktreeId]
			: undefined;

	// True when the session being deleted is the sole occupant of its
	// worktree. We can't trust `pendingDeleteWorktree.sessionIds` — main
	// broadcasts `state:changed` skip-self when it mutates the reverse
	// index (attach/detach), so the ORIGINATING window's copy stays
	// stale until another push. Count from the sessions store instead,
	// which the same window keeps authoritative via `session:started` /
	// `session:patch` broadcasts (both delivered even to originator).
	const isLastOnWorktree = useMemo(() => {
		if (!pendingDeleteWorktree || !pendingDeleteId) return false;
		let count = 0;
		for (const id of order) {
			if (sessions[id]?.worktreeId === pendingDeleteWorktree.id) {
				count++;
				if (count > 1) return false;
			}
		}
		// count === 1 AND that one is the pending-delete session.
		return (
			count === 1 &&
			sessions[pendingDeleteId]?.worktreeId === pendingDeleteWorktree.id
		);
	}, [pendingDeleteWorktree, pendingDeleteId, order, sessions]);

	const confirmDelete = async () => {
		if (!pendingDeleteId || deleting) return;
		// Capture before the async work — pendingDeleteId may be cleared
		// by the time we want to make the routing decision.
		const wasActive = pendingDeleteId === activeSessionId;
		// Capture the cascade target before the awaits — after
		// `removeSession` runs, pendingDeleteSession dereferences to
		// undefined and we lose the worktree id.
		const cascadeWorktreeId =
			alsoDeleteWorktree && isLastOnWorktree
				? pendingDeleteWorktree?.id
				: undefined;
		setDeleting(true);
		setDeleteError(null);
		try {
			await window.claude.deleteSession(pendingDeleteId);
			removeSession(pendingDeleteId);
			usePermissionsStore.getState().removeBySessionId(pendingDeleteId);
			// Cascade AFTER session delete: `session:delete` detaches the
			// session from `worktree.sessionIds` before returning, so by
			// the time we reach this call `sessionIds` is empty and the
			// `worktrees:delete` handler's "no delete while attached"
			// guard passes. Reuses the same IPC AttachWorktreeModal
			// calls, so on-disk cleanup + registry removal + skip-self
			// broadcast all behave identically.
			if (cascadeWorktreeId) {
				await window.claude.deleteWorktree(cascadeWorktreeId);
				useWorktreesStore.getState().remove(cascadeWorktreeId);
			}
			setPendingDeleteId(null);
			setAlsoDeleteWorktree(false);
			// If the deleted session was the one currently open in the right
			// pane, drop back to "/" so the right pane goes empty — otherwise
			// SessionChat would render its "Session not found." state.
			if (wasActive) navigate("/");
		} catch (err) {
			// If the session delete succeeded but the worktree delete
			// failed, the modal stays open with the error visible; the
			// row is already gone from the sidebar (removeSession ran).
			// User can dismiss and clean the worktree up later via
			// AttachWorktreeModal — mirrors how that flow surfaces the
			// same class of failure.
			setDeleteError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeleting(false);
		}
	};

	const cancelDelete = () => {
		if (deleting) return;
		setPendingDeleteId(null);
		setDeleteError(null);
		setAlsoDeleteWorktree(false);
	};

	const deleteModal = (
		<ConfirmModal
			open={!!pendingDeleteId}
			title="Delete session?"
			message={
				<>
					Remove <strong>{pendingDeleteSession?.title ?? "this session"}</strong>{" "}
					from this app. Claude Code's own session history (in{" "}
					<code>~/.claude</code>) is not affected.
					{isLastOnWorktree && pendingDeleteWorktree ? (
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginTop: 12,
								cursor: deleting ? "default" : "pointer",
								fontSize: 13,
								color: T.text,
								userSelect: "none",
							}}
						>
							{/* Hidden native input keeps keyboard/screen-reader
							    behaviour; the styled span below is the
							    visible affordance, matching the MenuItem
							    checkbox pattern in the workspace filter. */}
							<input
								type="checkbox"
								checked={alsoDeleteWorktree}
								disabled={deleting}
								onChange={(e) =>
									setAlsoDeleteWorktree(e.target.checked)
								}
								style={{
									position: "absolute",
									opacity: 0,
									pointerEvents: "none",
									width: 0,
									height: 0,
								}}
							/>
							<span
								aria-hidden
								style={{
									width: 14,
									height: 14,
									borderRadius: 3,
									flexShrink: 0,
									border: `1.5px solid ${
										alsoDeleteWorktree ? T.accent : T.border
									}`,
									background: alsoDeleteWorktree
										? T.accent
										: "transparent",
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									transition:
										"background 120ms ease, border-color 120ms ease",
								}}
							>
								{alsoDeleteWorktree ? (
									<svg width="9" height="9" viewBox="0 0 8 8">
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
							<span>
								Also delete worktree{" "}
								<strong>{pendingDeleteWorktree.displayName}</strong>
							</span>
						</label>
					) : null}
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

	const removeFromGroup = async (sessionId: string) => {
		// No confirm modal — removal is benign and self-undoable (re-add via
		// the ⋯ menu), mirroring unarchive. If this was the group's last
		// member, main auto-deletes the group and pings all windows.
		try {
			await window.claude.setSessionGroup(sessionId, null);
		} catch (err) {
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	// Ungrouped rows render under subtle per-cwd headers; each group renders
	// into its own bordered wrapper (header + member rows share one framed
	// block, colored on every side by the group's border token). Session
	// rows inside a group live under a different DOM parent than ungrouped
	// ones, so moving a row between the two remounts it — an acceptable
	// cost for the framed look; session cards hold only trivial local
	// state (menu open).
	const sidebarRows = useMemo<SidebarRow[]>(() => {
		const rows: SidebarRow[] = [];
		// A lone cwd needs no sectioning — skip the boxes entirely and
		// render the flat list (rows keep their own cwd footers instead).
		const sectioned = ungroupedBuckets.length > 1;
		for (const bucket of ungroupedBuckets) {
			if (sectioned) {
				rows.push({
					kind: "cwdBucket",
					cwd: bucket.cwd,
					ids: bucket.ids,
					collapsed: collapsedCwds.has(bucket.cwd),
				});
			} else {
				bucket.ids.forEach((id, i) => {
					rows.push({
						kind: "session",
						id,
						lastInBucket: i === bucket.ids.length - 1,
					});
				});
			}
		}
		for (const section of groupSections) {
			rows.push({ kind: "group", section });
		}
		return rows;
	}, [ungroupedBuckets, groupSections, collapsedCwds]);

	// Shared renderer for ungrouped session rows — used both inside cwd
	// bucket boxes (hideCwd: the header already names the folder) and in
	// the flat single-cwd list (footer shown).
	const renderSessionRow = (id: string, last: boolean, hideCwd: boolean) => {
		const s = sessions[id];
		const sessionPending = queue.filter((q) => q.sessionId === id);
		return (
			<SessionRowSidebar
				key={id}
				session={s}
				last={last}
				hideCwd={hideCwd}
				pending={sessionPending}
				active={id === activeSessionId}
				onDelete={() => {
					setPendingDeleteId(id);
					setDeleteError(null);
					setAlsoDeleteWorktree(false);
				}}
				onArchive={() => {
					setPendingArchiveId(id);
					setArchiveError(null);
				}}
				onUnarchive={() => void unarchive(id)}
				onAddToGroup={() => setPendingGroupSessionId(id)}
				onRemoveFromGroup={() => void removeFromGroup(id)}
			/>
		);
	};

	const toggleGroupCollapsed = (group: SessionGroup) => {
		const next = { ...group, collapsed: !group.collapsed };
		// Optimistic local flip so the section folds on the same tick as the
		// click; the IPC persists it and pings other windows (skip-self).
		useSessionGroupsStore.getState().upsert(next);
		void window.claude
			.setGroupCollapsed(group.id, next.collapsed)
			.catch((err) => {
				console.error("[ccw] setGroupCollapsed failed:", err);
			});
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
				{order.length === 0 && !draft ? (
					<div className="message" style={{ margin: 12 }}>
						No sessions yet. Click "New Session".
					</div>
				) : visibleOrder.length === 0 && !draft ? (
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
						{draft ? (
							<DraftRowSidebar
								draft={draft}
								active={draft.id === activeSessionId}
								last={sidebarRows.length === 0}
								onDiscard={() => discardDraft(draft.id)}
							/>
						) : null}
						{sidebarRows.map((row) => {
							if (row.kind === "cwdBucket") {
								return (
									<div
										key={`cwd:${row.cwd}`}
										style={{
											// Recessed dark box encapsulates the
											// whole bucket (header + rows) — the
											// neutral sibling of GroupSection's
											// framed look. Rows render
											// transparent, so T.bg shows through
											// the full section.
											margin: "8px 0",
											background: T.bg,
											// Top hairline only — same recipe as
											// the header's under-rule. It sits
											// flush on the dark fill (a section
											// edge) rather than floating in the
											// gap the way a bottom rule did.
											borderTop: `1px solid ${T.borderSoft}`,
											overflow: "hidden",
										}}
									>
										<CwdHeaderRow
											cwd={row.cwd}
											collapsed={row.collapsed}
											onToggle={() =>
												toggleCwdCollapsed(row.cwd)
											}
										/>
										{row.collapsed
											? null
											: row.ids.map((id, i) =>
												renderSessionRow(
													id,
													i === row.ids.length - 1,
													true,
												),
											)}
									</div>
								);
							}
							if (row.kind === "group") {
								const { group, ids } = row.section;
								return (
									<GroupSection
										key={`group:${group.id}`}
										group={group}
										ids={ids}
										sessions={sessions}
										queue={queue}
										lastReadAtMap={lastReadAtMap}
										activeSessionId={activeSessionId}
										onToggleCollapsed={() =>
											toggleGroupCollapsed(group)
										}
										onRename={(id) =>
											setPendingRenameGroupId(id)
										}
										onDelete={(id) => {
											setPendingDeleteId(id);
											setDeleteError(null);
											setAlsoDeleteWorktree(false);
										}}
										onArchive={(id) => {
											setPendingArchiveId(id);
											setArchiveError(null);
										}}
										onUnarchive={(id) => void unarchive(id)}
										onAddToGroup={(id) =>
											setPendingGroupSessionId(id)
										}
										onRemoveFromGroup={(id) =>
											void removeFromGroup(id)
										}
									/>
								);
							}
							return renderSessionRow(
								row.id,
								row.lastInBucket,
								false,
							);
						})}
					</div>
				)}
			</div>

			{deleteModal}
			{archiveModal}
			<AddToGroupModal
				sessionId={pendingGroupSessionId}
				onClose={() => setPendingGroupSessionId(null)}
			/>
			<RenameGroupModal
				groupId={pendingRenameGroupId}
				onClose={() => setPendingRenameGroupId(null)}
			/>
		</div>
	);
}

/** One entry in the sidebar's top-level render sequence. */
type SidebarRow =
	/** One cwd's worth of ungrouped sessions, rendered as a recessed dark
	 * box (header + member rows). Only used when 2+ cwds are present. */
	| { kind: "cwdBucket"; cwd: string; ids: string[]; collapsed: boolean }
	/** Flat ungrouped row — the single-cwd case, no sectioning. */
	| { kind: "session"; id: string; lastInBucket: boolean }
	| { kind: "group"; section: { group: SessionGroup; ids: string[] } };

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
	inGroup = false,
	groupColor,
	hideCwd = false,
	onDelete,
	onArchive,
	onUnarchive,
	onAddToGroup,
	onRemoveFromGroup,
}: {
	session: ClaudeSessionFull;
	last: boolean;
	pending: PermissionRequest[];
	active: boolean;
	/** True when the row sits under a CwdHeaderRow — the header already
	 * names the folder, so the per-row cwd footer would be redundant. */
	hideCwd?: boolean;
	/** True when the row renders inside a group's bordered section — the
	 * container owns the color border, so the row itself just adopts the
	 * raised surface + indent + grouped ⋯ menu options. Also the source of
	 * truth for the menu's grouped state: a dangling groupId renders (and
	 * behaves) as ungrouped. */
	inGroup?: boolean;
	/** Resolved color spec of the enclosing group, if any. When set, the
	 * active-row background and left stripe tint to this hue instead of the
	 * neutral `T.surfaceHi` + `T.accent` — otherwise a selected row inside
	 * a colored group reads as a foreign grey block over the group's wash. */
	groupColor?: { fg: string; bg: string; border: string };
	onDelete: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
	onAddToGroup: () => void;
	onRemoveFromGroup: () => void;
}) {
	const { hasPending, summary, unread } = useRowDerived(session, pending);
	const markUnread = useReadStore((s) => s.markUnread);
	const archived = session.archivedAt != null;
	// Attached worktree (if any). Selector keyed by id so a rename in another
	// window flows through without a full row re-render pipeline.
	const worktree = useWorktreesStore((s) =>
		session.worktreeId ? s.worktrees[session.worktreeId] : undefined,
	);
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				// Only highlight the active row. Pending state is conveyed by the
				// "waiting for input" StatusPill and the count badge below.
				// Grouped members render transparent so the parent group
				// section's subtle color wash shows through the whole width
				// — one continuous tint instead of just a header strip.
				// When active inside a group, tint the highlight to the group's
				// hue so the selection stays part of the color family instead of
				// dropping a neutral grey block on top of the group's wash.
				background: active
					? groupColor
						? `color-mix(in oklab, ${groupColor.fg} 7%, transparent)`
						: T.surfaceHi
					: "transparent",
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
						background: groupColor ? groupColor.fg : T.accent,
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
					{/* Worktree row — sits ABOVE the title so it reads as a
					    scope marker for the whole session card, matching the
					    session-header treatment. Only rendered when attached. */}
					{worktree ? (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								minWidth: 0,
							}}
						>
							<WorktreeChip
								displayName={worktree.displayName}
								color={worktree.color}
								variant="readonly"
								small
							/>
						</div>
					) : null}
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
							grouped={inGroup}
							onAddToGroup={onAddToGroup}
							onRemoveFromGroup={onRemoveFromGroup}
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
					{/* Chips row — worktree moved to the row above the title,
					    so this is just the status + branch pair now. */}
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
					{session.cwd && !hideCwd ? (
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

/**
 * Framed container for a single group: colored border on every side (the
 * group's `border` token), raised `surfaceLow` fill, and a hairline
 * bottom-margin so successive groups don't fuse. Header sits at the top,
 * followed by member rows (when expanded). No rounding — matches the
 * app's square-cornered vocabulary.
 */
function GroupSection({
	group,
	ids,
	sessions,
	queue,
	lastReadAtMap,
	activeSessionId,
	onToggleCollapsed,
	onRename,
	onDelete,
	onArchive,
	onUnarchive,
	onAddToGroup,
	onRemoveFromGroup,
}: {
	group: SessionGroup;
	ids: string[];
	sessions: Record<string, ClaudeSessionFull>;
	queue: PermissionRequest[];
	lastReadAtMap: Record<string, number>;
	activeSessionId?: string;
	onToggleCollapsed: () => void;
	onRename: (groupId: string) => void;
	onDelete: (id: string) => void;
	onArchive: (id: string) => void;
	onUnarchive: (id: string) => void;
	onAddToGroup: (id: string) => void;
	onRemoveFromGroup: (id: string) => void;
}) {
	const c = WORKTREE_COLOR_MAP[group.color];
	// Only draw aggregate indicators when the section is folded — expanded
	// members show their own dots/pills; doubling up would be noise.
	const aggregates = group.collapsed
		? deriveGroupAggregates(ids, sessions, queue, lastReadAtMap)
		: null;
	return (
		<div
			style={{
				// Horizontal rules only (top + bottom) in the group's color.
				// A very subtle wash of the group hue tints the entire section
				// (header + rows) — the rows themselves render transparent
				// when `inGroup` so this fill shows through the full width.
				// 2% of `c.fg` keeps the wash whisper-quiet against `T.win`.
				borderTop: `1px solid ${c.border}`,
				borderBottom: `1px solid ${c.border}`,
				// Breathing room above/below so consecutive groups (or a
				// group next to a top-level row) don't butt up against each
				// other — the colored borders read as their own object.
				margin: "8px 0",
				background: `color-mix(in oklab, ${c.fg} 2%, transparent)`,
				overflow: "hidden",
			}}
		>
			<GroupHeaderRow
				group={group}
				count={ids.length}
				aggregates={aggregates}
				onToggle={onToggleCollapsed}
				onRename={() => onRename(group.id)}
			/>
			{group.collapsed
				? null
				: ids.map((id, i) => {
					const s = sessions[id];
					const sessionPending = queue.filter(
						(q) => q.sessionId === id,
					);
					return (
						<SessionRowSidebar
							key={id}
							session={s}
							last={i === ids.length - 1}
							pending={sessionPending}
							active={id === activeSessionId}
							inGroup
							groupColor={c}
							onDelete={() => onDelete(id)}
							onArchive={() => onArchive(id)}
							onUnarchive={() => onUnarchive(id)}
							onAddToGroup={() => onAddToGroup(id)}
							onRemoveFromGroup={() =>
								onRemoveFromGroup(id)
							}
						/>
					);
				})}
		</div>
	);
}

/**
 * Collapsible section header for a session group. The bordered box lives
 * on the outer `GroupSection`; this component paints the clickable header
 * strip (chevron + colored uppercase name + count + optional aggregate
 * indicators when collapsed).
 */
/**
 * Collapsible header strip for a cwd bucket. The recessed dark box lives
 * on the wrapping div in the sidebar's render map (T.bg background +
 * hairline frame); this paints the clickable header inside it — same
 * vocabulary as GroupHeaderRow but neutral (no group color) so it stays
 * subordinate to real groups. Tooltip carries the full path, which
 * disambiguates same-basename dirs.
 */
function CwdHeaderRow({
	cwd,
	collapsed,
	onToggle,
}: {
	cwd: string;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			title={cwd}
			onClick={onToggle}
			aria-expanded={!collapsed}
			style={{
				appearance: "none",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 7,
				padding: "9px 12px",
				// The wrapping bucket box owns the dark fill; the header just
				// splits itself from the first member row with a hairline
				// when expanded (GroupHeaderRow's move).
				background: "transparent",
				border: "none",
				borderBottom: collapsed
					? "none"
					: `0.5px solid ${T.borderSoft}`,
				cursor: "pointer",
				textAlign: "left",
				outline: "none",
			}}
		>
			<svg
				width="8"
				height="8"
				viewBox="0 0 8 8"
				fill="none"
				aria-hidden
				style={{
					flexShrink: 0,
					color: T.textFaint,
					// Points right when collapsed, down when open — same
					// vocabulary as GroupHeaderRow's chevron.
					transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
					transition: "transform 120ms ease",
				}}
			>
				<path
					d="M2.5 1.5L6 4L2.5 6.5"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span
				style={{
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: 0.5,
					textTransform: "uppercase",
					color: T.textMute,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
				}}
			>
				{folderName(cwd) || cwd || "no folder"}
			</span>
		</button>
	);
}

function GroupHeaderRow({
	group,
	count,
	aggregates,
	onToggle,
	onRename,
}: {
	group: SessionGroup;
	count: number;
	aggregates: { waiting: number; unread: number } | null;
	onToggle: () => void;
	onRename: () => void;
}) {
	// Cursor coords of the current right-click, or null when the menu is
	// closed. Fixed positioning against the viewport so the menu escapes
	// the sidebar's scroll container / overflow-hidden group box.
	const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(
		null,
	);
	const c = WORKTREE_COLOR_MAP[group.color];
	return (
		<>
			<button
				type="button"
				onClick={onToggle}
				onContextMenu={(e) => {
					e.preventDefault();
					setMenuPos({ x: e.clientX, y: e.clientY });
				}}
				aria-expanded={!group.collapsed}
				style={{
					appearance: "none",
					width: "100%",
					display: "flex",
					alignItems: "center",
					gap: 7,
					padding: "8px 12px",
					// Bottom hairline appears only when expanded, splitting the
					// header from the first member row; collapsed headers stand
					// alone inside the bordered box.
					borderTop: "none",
					borderLeft: "none",
					borderRight: "none",
					borderBottom: group.collapsed
						? "none"
						: `0.5px solid ${T.borderSoft}`,
					background: "transparent",
					cursor: "pointer",
					textAlign: "left",
					outline: "none",
				}}
			>
				<svg
					width="8"
					height="8"
					viewBox="0 0 8 8"
					fill="none"
					aria-hidden
					style={{
						flexShrink: 0,
						color: T.textFaint,
						transform: group.collapsed
							? "rotate(0deg)"
							: "rotate(90deg)",
						transition: "transform 120ms ease",
					}}
				>
					<path
						d="M2.5 1.5L6 4L2.5 6.5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				{/* Group color lives on the name itself (no separate dot) —
				    one fewer element, and the label doubles as the swatch. */}
				<span
					style={{
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: 0.5,
						textTransform: "uppercase",
						color: c.fg,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						minWidth: 0,
					}}
				>
					{group.name}
				</span>
				<span
					style={{
						fontSize: 10.5,
						color: T.textFaint,
						flexShrink: 0,
					}}
				>
					{count}
				</span>
				{aggregates &&
				(aggregates.unread > 0 || aggregates.waiting > 0) ? (
						<span
							style={{
								marginLeft: "auto",
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								flexShrink: 0,
							}}
						>
							{aggregates.waiting > 0 ? (
								<span
									title={`${aggregates.waiting} session${
										aggregates.waiting === 1 ? "" : "s"
									} waiting for input`}
									style={{
										display: "inline-flex",
										alignItems: "center",
										height: 16,
										padding: "0 6px",
										borderRadius: 8,
										border: `0.5px solid ${T.warnBorder}`,
										background: T.warnSoft,
										color: T.warn,
										fontSize: 10,
										fontWeight: 600,
									}}
								>
									{aggregates.waiting}
								</span>
							) : null}
							{aggregates.unread > 0 ? (
								<span
									title={`${aggregates.unread} unread`}
									style={{
										display: "inline-flex",
										alignItems: "center",
										height: 16,
										padding: "0 6px",
										borderRadius: 8,
										border: `0.5px solid ${T.accentBorder}`,
										background: T.accentSoft,
										color: T.accent,
										fontSize: 10,
										fontWeight: 600,
									}}
								>
									{aggregates.unread}
								</span>
							) : null}
						</span>
					) : null}
			</button>
			{menuPos ? (
				<GroupContextMenu
					x={menuPos.x}
					y={menuPos.y}
					onClose={() => setMenuPos(null)}
					onRename={() => {
						setMenuPos(null);
						onRename();
					}}
				/>
			) : null}
		</>
	);
}

/**
 * Right-click context menu for a group header. Deliberately minimal —
 * one item today ("Rename") — but structured so more (Change color,
 * Delete, …) drop in as `MenuItem`s under the same shell.
 *
 * Positioning: `position: fixed` at the cursor's viewport coordinates so
 * the menu escapes the sidebar's scroll container and the group box's
 * `overflow: hidden`. Dismissal: Escape or a mousedown anywhere outside
 * the menu, matching the RowMenuButton dropdown pattern already used
 * throughout the sidebar.
 */
function GroupContextMenu({
	x,
	y,
	onClose,
	onRename,
}: {
	x: number;
	y: number;
	onClose: () => void;
	onRename: () => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		const onDown = (e: MouseEvent) => {
			if (!ref.current) return;
			if (!ref.current.contains(e.target as Node)) onClose();
		};
		window.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onDown);
		return () => {
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDown);
		};
	}, [onClose]);
	return (
		<div
			ref={ref}
			role="menu"
			style={{
				position: "fixed",
				top: y,
				left: x,
				minWidth: 160,
				background: T.surfaceHi,
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
				padding: 4,
				zIndex: 1000,
			}}
		>
			<button
				type="button"
				role="menuitem"
				onClick={onRename}
				style={{
					appearance: "none",
					width: "100%",
					textAlign: "left",
					background: "transparent",
					border: "none",
					color: T.text,
					font: "inherit",
					fontSize: 12.5,
					padding: "6px 10px",
					borderRadius: 4,
					cursor: "pointer",
					transition: "background 60ms ease",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = T.accentSoft;
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = "transparent";
				}}
			>
				Rename…
			</button>
		</div>
	);
}

/**
 * Sidebar row for the in-memory draft session — the one created by clicking
 * New Session before any message has been sent. Visually echoes
 * `SessionRowSidebar` (active stripe, hover/menu, cwd footer) so the row
 * doesn't look out of place, but strips everything that doesn't apply:
 *   - title is italic + paired with a "Draft" pill instead of a status chip
 *   - no unread dot, no branch chip, no summary clamp
 *   - ⋯ menu has a single "Discard" item (drafts are in-memory, so there's
 *     no archive/delete/mark-unread distinction to expose)
 */
function DraftRowSidebar({
	draft,
	active,
	last,
	onDiscard,
}: {
	draft: DraftSession;
	active: boolean;
	last: boolean;
	onDiscard: () => void;
}) {
	const worktree = useWorktreesStore((s) =>
		draft.worktreeId ? s.worktrees[draft.worktreeId] : undefined,
	);
	return (
		<div
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
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
				to={`/sessions/${draft.id}`}
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
					{/* Worktree row — sits ABOVE the title, matching the real
					    session row and the session-header treatment. Only
					    rendered when the draft has one attached. */}
					{worktree ? (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								minWidth: 0,
							}}
						>
							<WorktreeChip
								displayName={worktree.displayName}
								color={worktree.color}
								variant="readonly"
								small
							/>
						</div>
					) : null}
					{/* Title row */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							minWidth: 0,
						}}
					>
						<span
							style={{
								flex: 1,
								minWidth: 0,
								fontSize: 13.5,
								fontWeight: 500,
								fontStyle: "italic",
								color: T.textDim,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{/* An unnamed draft shows its `Session N` placeholder;
							    once the user types a name in the draft header it
							    appears here live. Styling is identical either way —
							    the Draft pill already signals "provisional", and
							    toggling italic mid-typing would make the row jitter. */}
							{draft.title.trim() || draft.defaultTitle}
						</span>
						<DraftRowMenu onDiscard={onDiscard} />
					</div>
					{/* Pill row — Draft badge only; the worktree chip lives
					    above the title now. */}
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							alignItems: "center",
							gap: 6,
							minWidth: 0,
						}}
					>
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								height: 18,
								padding: "0 7px",
								borderRadius: 9,
								border: `0.5px solid ${T.border}`,
								background: T.surface,
								color: T.textMute,
								fontSize: 10.5,
								fontWeight: 600,
								letterSpacing: 0.5,
								textTransform: "uppercase",
							}}
						>
							Draft
						</span>
					</div>
					<div
						title={draft.cwd}
						style={{
							fontSize: 11,
							color: T.textFaint,
							fontFamily: T.mono,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{folderName(draft.cwd)}
					</div>
				</div>
			</Link>
		</div>
	);
}

function DraftRowMenu({ onDiscard }: { onDiscard: () => void }) {
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
					<MenuItem
						active={false}
						label="Discard"
						danger
						onClick={() => {
							setOpen(false);
							onDiscard();
						}}
					/>
				</div>
			) : null}
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
	grouped,
	onAddToGroup,
	onRemoveFromGroup,
}: {
	onDelete: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
	archived: boolean;
	onMarkUnread: () => void;
	showMarkUnread: boolean;
	grouped: boolean;
	onAddToGroup: () => void;
	onRemoveFromGroup: () => void;
}) {
	const [open, setOpen] = useState(false);
	// Viewport coordinates of the anchor point (the button's bottom-right
	// corner) captured at open time. `null` when the menu is closed. Used
	// with `position: fixed` on the menu so it escapes the group box's
	// `overflow: hidden` — see the block comment on `GroupContextMenu` for
	// the same pattern applied to the group header's right-click menu.
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
		null,
	);
	const ref = useRef<HTMLDivElement>(null);
	const btnRef = useRef<HTMLButtonElement>(null);

	const close = () => {
		setOpen(false);
		setAnchor(null);
	};

	const openMenu = () => {
		const rect = btnRef.current?.getBoundingClientRect();
		if (!rect) return;
		// `top`: 4px gap below the button, matching the previous
		// `calc(100% + 4px)` offset. `left`: pin to the button's right edge;
		// the menu is right-aligned via `translateX(-100%)` in its style,
		// preserving the pre-fix placement without needing to know the
		// menu's rendered width.
		setAnchor({ top: rect.bottom + 4, left: rect.right });
		setOpen(true);
	};

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				close();
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		// A fixed-positioned menu doesn't track its anchor when the viewport
		// changes, so close on scroll/resize rather than recompute. Capture
		// phase on `scroll` catches the sidebar's inner scroller, not just
		// window. This intentionally diverges from `GroupContextMenu` (which
		// doesn't handle either): that menu is a transient right-click
		// gesture, this one is a click-opened dropdown users may leave
		// hovering while they scroll.
		const onViewportChange = () => close();
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange);
		};
	}, [open]);

	const runAndClose = (fn: () => void) => () => {
		close();
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
				ref={btnRef}
				type="button"
				onClick={() => (open ? close() : openMenu())}
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
			{open && anchor ? (
				<div
					role="menu"
					style={{
						// `position: fixed` at the button's viewport-space
						// bottom-right corner lets the menu escape the group
						// box's `overflow: hidden` (see `GroupSection`) which
						// used to clip the last item when the row lived in a
						// group. `translateX(-100%)` right-aligns the menu
						// to the button without needing to know its width.
						position: "fixed",
						top: anchor.top,
						left: anchor.left,
						transform: "translateX(-100%)",
						minWidth: 160,
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 1000,
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
					{/* Available on archived rows too — membership survives
					    archiving, so an archived row (visible via "Show
					    archived sessions") can be re-filed or pulled out of
					    its group like any other. */}
					{grouped ? (
						<MenuItem
							active={false}
							label="Remove from group"
							onClick={runAndClose(onRemoveFromGroup)}
						/>
					) : (
						<MenuItem
							active={false}
							label="Add to group…"
							onClick={runAndClose(onAddToGroup)}
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

/**
 * Attention rollup for a collapsed group header. Plain function (not a
 * hook) on purpose — it runs once per group inside the row-render loop,
 * where per-session hooks like `useRowDerived` would be illegal. Mirrors
 * that hook's rules exactly:
 *   - waiting: pending permission request in the queue, or the session
 *     status itself is awaiting_permission (same pair StatusPill uses);
 *   - unread: not running AND last incoming message is newer than the
 *     session's lastReadAt mark.
 */
function deriveGroupAggregates(
	ids: string[],
	sessions: Record<string, ClaudeSessionFull>,
	queue: PermissionRequest[],
	lastReadAt: Record<string, number>,
): { waiting: number; unread: number } {
	let waiting = 0;
	let unread = 0;
	const pendingIds = new Set(queue.map((q) => q.sessionId));
	for (const id of ids) {
		const s = sessions[id];
		if (!s) continue;
		if (pendingIds.has(id) || s.status === "awaiting_permission") waiting++;
		if (
			s.status !== "running" &&
			lastIncomingMessageTs(s) > (lastReadAt[id] ?? 0)
		) {
			unread++;
		}
	}
	return { waiting, unread };
}

function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant") continue;
		// Subagent traffic is hidden from the conversation (old stores still
		// contain it) — it must not drive unread/recency derivations.
		if (isConversationSkipped(m.role, m.content)) continue;
		return m.ts;
	}
	return 0;
}

function lastConversationMessage(
	session: ClaudeSessionFull,
): SessionMessage | undefined {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "user" && m.role !== "assistant") continue;
		// Skip messages hidden from the transcript — subagent traffic and
		// user turns that render nothing (e.g. <local-command-stdout>) —
		// so the summary never attributes them to the conversation.
		if (isConversationSkipped(m.role, m.content)) continue;
		return m;
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
	// Interrupt markers are visible transcript rows, so they legitimately end
	// up here — but they're state, not speech, so no "You:" prefix.
	const interrupt = interruptMarkerText(last.content);
	if (interrupt) return interrupt;
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
