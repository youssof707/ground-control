import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { appDefaultModel, useSettingsStore } from "../stores/useSettingsStore";
import {
	useDraftSessionsStore,
	type DraftSession,
} from "../stores/useDraftSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";
import { useSidequestsStore } from "../stores/useSidequestsStore";
import { pushUndo, useUndoStore } from "../stores/useUndoStore";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { RecentlyDeletedModal } from "./RecentlyDeletedModal";
import { runBackgroundTask } from "../../background-tasks/stores/useBackgroundTasksStore";
import {
	startNewSessionDraft,
	startSessionFromShortcut,
	startSessionFromSkill,
} from "../lib/sessionStartActions";
import { AddToGroupModal } from "./AddToGroupModal";
import { RenameGroupModal } from "./RenameGroupModal";
import { SettingsModal } from "./SettingsModal";
import { ShortcutsMenuButton } from "./ShortcutsMenu";
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
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import type { Worktree } from "@shared/schemas/worktrees";

/**
 * Selected-row fill. Translucent rather than a fixed surface token so the row
 * lifts by the same perceptual amount from whatever sits behind it — the
 * sidebar pane (`T.win`) or a recessed cwd/worktree bucket (`T.bg`). A fixed
 * `T.surfaceHi` over-shot inside the darker bucket and read lighter than the
 * pane around it, so the selection escaped its own box.
 * The tint itself is near-neutral text color with just a 1% hint of accent
 * blue mixed in — not the accent swatch directly, which at any visible
 * opacity reads as a saturated blue box instead of a grey highlight. That
 * whisper-tinted grey is then laid down at 4% opacity for the lift.
 */
const ROW_SELECTED_TINT = `color-mix(in oklab, ${T.text} 99%, ${T.accent} 1%)`;
const ROW_SELECTED_BG = `color-mix(in oklab, ${ROW_SELECTED_TINT} 4%, transparent)`;

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
	const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
	// Non-persistent view toggle: when true, archived sessions are no longer
	// filtered out of the sidebar list (and their cwds appear in the
	// workspace filter). Resets to false on reload — mirrors how
	// workspaceFilter behaves.
	const [showArchived, setShowArchived] = useState(false);
	// Read-only settings modal, opened from the view-options dropdown.
	const [settingsOpen, setSettingsOpen] = useState(false);
	// "Recently deleted" list, also opened from the view-options dropdown —
	// the durable surface for undo once the toast has expired.
	const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false);
	const undoEntries = useUndoStore((s) => s.entries);
	// Collapsed ungrouped buckets. Keys are cwd paths for cwd buckets and
	// `wt:<worktreeId>` for worktree buckets (cwds are absolute paths or "",
	// so the prefix can't collide). Non-persistent view state — resets on
	// reload, mirroring workspaceFilter / showArchived above.
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
	// Force a bucket open — used when a draft is spawned into it so the new
	// row is never hidden inside a collapsed box.
	const expandCwd = (key: string) => {
		setCollapsedCwds((prev) => {
			if (!prev.has(key)) return prev;
			const next = new Set(prev);
			next.delete(key);
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

	// Whether to render the filter/view-options row under the New Session
	// button. `undoEntries.length` counts because that row holds the kebab,
	// which is the ONLY way to reach "Recently deleted" — without it a fresh
	// install (no workspaces, nothing archived) would hide the kebab and
	// strand the undo buffer behind a hotkey nobody can discover.
	const showFilterRow =
		workspaces.length > 0 || archivedCount > 0 || undoEntries.length > 0;

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
	// by cwd — or by worktree for worktree-bound sessions — under subtle
	// headers) and per-group sections (rendered after, newest group first).
	// Precedence per session: manual group > worktree > cwd. Built from
	// `visibleOrder`, so:
	//   - intra-bucket / intra-group ordering matches the flat list's
	//     comparator exactly (newest first; archived sink within their
	//     bucket — the per-bucket analogue of the global convention above);
	//   - a group whose members are all filtered out (workspace filter,
	//     archived-hidden) never materializes a section → hidden, per spec;
	//   - a dangling groupId (group record missing — crash window, stale
	//     cache) degrades to "ungrouped" instead of vanishing the row, and
	//     a dangling worktreeId likewise degrades to the cwd bucket.
	const { ungroupedBuckets, groupSections, hideCwdPrefix } =
		useMemo(() => {
			const byCwd = new Map<string, string[]>();
			const byWorktree = new Map<string, string[]>();
			const byGroup = new Map<string, string[]>();
			for (const id of visibleOrder) {
				const s = sessions[id];
				const gid = s?.groupId;
				const wtId = s?.worktreeId;
				if (gid && groups[gid]) {
					const list = byGroup.get(gid);
					if (list) list.push(id);
					else byGroup.set(gid, [id]);
				} else if (wtId && worktrees[wtId]) {
					const list = byWorktree.get(wtId);
					if (list) list.push(id);
					else byWorktree.set(wtId, [id]);
				} else {
					const cwd = s?.cwd ?? "";
					const list = byCwd.get(cwd);
					if (list) list.push(id);
					else byCwd.set(cwd, [id]);
				}
			}
			// "One cwd" for label purposes = distinct folders across ALL
			// visible ungrouped buckets (cwd buckets ∪ worktree baseDirs).
			// With a single folder, the worktree headers drop the redundant
			// "folder: " prefix and show just the worktree name.
			const distinctCwds = new Set<string>(byCwd.keys());
			for (const wtId of byWorktree.keys()) {
				const wt = worktrees[wtId];
				if (wt) distinctCwds.add(wt.baseDir);
			}
			const hidePrefix = distinctCwds.size <= 1;
			// Buckets sort alphabetically by FULL display label even when the
			// rendered label hides the prefix — ordering stays stable, and
			// "repo" < "repo: worktree" naturally clusters each worktree box
			// right after its base repo's bucket. Tie-breaks: cwd buckets
			// before worktree buckets, then full-path / worktree-id.
			const sortKey = (b: UngroupedBucket) =>
				b.kind === "cwd"
					? folderName(b.cwd)
					: `${folderName(b.worktree.baseDir)}: ${b.worktree.displayName}`;
			const tieKey = (b: UngroupedBucket) =>
				b.kind === "cwd" ? b.cwd : b.worktree.id;
			const buckets: UngroupedBucket[] = [
				...Array.from(byCwd.entries()).map(
					([cwd, ids]) => ({ kind: "cwd", cwd, ids }) as const,
				),
				...Array.from(byWorktree.entries()).map(
					([wtId, ids]) =>
						({
							kind: "worktree",
							worktree: worktrees[wtId],
							ids,
						}) as const,
				),
			].sort(
				(a, b) =>
					sortKey(a).localeCompare(sortKey(b)) ||
					a.kind.localeCompare(b.kind) ||
					tieKey(a).localeCompare(tieKey(b)),
			);
			const sections = Array.from(byGroup.entries())
				.map(([gid, ids]) => ({ group: groups[gid], ids }))
				// Newest group first; ulid tie-break keeps same-ms creates stable.
				.sort(
					(a, b) =>
						b.group.createdAt - a.group.createdAt ||
						b.group.id.localeCompare(a.group.id),
				);
			return {
				ungroupedBuckets: buckets,
				groupSections: sections,
				hideCwdPrefix: hidePrefix,
			};
		}, [visibleOrder, sessions, groups, worktrees]);

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

	const createDraftAndNavigate = (
		cwd: string,
		worktreeId?: string,
		groupId?: string,
	) => {
		// Remember the workspace immediately so the next New Session click
		// pre-fills the same folder (parity with the old IPC-direct flow).
		// If the main process later substitutes a different cwd at first send
		// (missing-folder recovery picker), the bootstrap listener for
		// `session:started` already reconciles the store from the broadcast.
		useSettingsStore.getState().setLastUsedWorkspace(cwd);
		const d = useDraftSessionsStore.getState().createDraft({
			cwd,
			defaultTitle: `Session ${order.length + 1}`,
			worktreeId,
			groupId,
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

	// Shares `startNewSessionDraft` with the global Cmd+N hotkey so the button
	// and the shortcut can't drift on worktree seeding. The helper handles the
	// draft-reuse rule, the folder picker fallback, and pre-attaching the
	// worktree last used in the target workspace; `onWorkspaceRevealed` keeps
	// the new draft visible under a narrowed filter, the same reconciliation
	// `createDraftAndNavigate` does inline.
	const start = async () => {
		setStartError(null);
		await startNewSessionDraft(navigate, {
			targetCwd,
			onWorkspaceRevealed: (cwd) =>
				setWorkspaceFilter((prev) =>
					prev.length === 0 || prev.includes(cwd) ? prev : [...prev, cwd],
				),
		});
	};

	// Per-bucket New Session. Unlike `start`, the target folder is explicit,
	// so there is no picker and no async path. When a draft already exists we
	// RETARGET it rather than refusing or replacing it: the single-slot rule
	// still holds and the user's typed text survives.
	const startInCwd = (cwd: string) => {
		setStartError(null);
		if (!cwd) return; // synthetic "" bucket ("no folder") has no target
		expandCwd(cwd);
		if (draft) {
			// This repurposes the shared draft slot for a plain "new session
			// here" intent, distinct from whatever it was doing before —
			// reset the model override to the app default and clear any
			// pending handoff-delete so neither rides along onto an
			// unrelated session. (See DraftSession.handoffDeleteSessionId
			// doc: every retarget site must disown it explicitly or an
			// abandoned "Handoff & delete" can later delete the wrong
			// session.)
			//
			// `groupId` is disowned UNCONDITIONALLY, not inside the cwd
			// guard below: "new session in this folder" is an inherently
			// UNGROUPED intent, so a draft seeded by a group header's "+"
			// must leave that group even when the cwd is unchanged —
			// otherwise draftHost (group beats cwd) keeps the row in the
			// group box the user just clicked away from, and the real
			// session is born inside a group nobody asked for.
			const patch: {
				cwd?: string;
				worktreeId?: string;
				groupId?: string;
				model?: string;
				handoffDeleteSessionId?: string;
			} = {
				model: appDefaultModel(),
				handoffDeleteSessionId: undefined,
				groupId: undefined,
			};
			if (draft.cwd !== cwd) {
				// A worktree is bound to a baseDir, so retargeting invalidates
				// the pairing — same rule as DraftSessionChat.changeFolder.
				patch.cwd = cwd;
				patch.worktreeId = undefined;
			}
			useDraftSessionsStore.getState().updateDraft(patch);
			if (draft.cwd !== cwd) {
				useSettingsStore.getState().setLastUsedWorkspace(cwd);
			}
			navigate(`/sessions/${draft.id}`);
			return;
		}
		createDraftAndNavigate(cwd);
	};

	// Per-worktree-bucket New Session: same retarget semantics as startInCwd,
	// but the draft is pre-seeded with BOTH the worktree's baseDir (the cwd a
	// worktree session records) and the worktree binding itself.
	const startInWorktree = (wt: Worktree) => {
		setStartError(null);
		expandCwd(`wt:${wt.id}`);
		if (draft) {
			// Same disowning rule as startInCwd: this is a fresh "new session
			// on this worktree" intent, so any leftover model override or
			// pending handoff-delete from whatever the draft was doing before
			// must not carry forward — the model resets to the app default,
			// not to nothing. `groupId` is disowned unconditionally for the
			// same reason as startInCwd: targeting a worktree bucket is an
			// ungrouped intent, and a stale groupId would keep the row
			// rendering inside the group box instead.
			const patch: {
				cwd?: string;
				worktreeId?: string;
				groupId?: string;
				model?: string;
				handoffDeleteSessionId?: string;
			} = {
				model: appDefaultModel(),
				handoffDeleteSessionId: undefined,
				groupId: undefined,
			};
			if (draft.cwd !== wt.baseDir || draft.worktreeId !== wt.id) {
				patch.cwd = wt.baseDir;
				patch.worktreeId = wt.id;
			}
			useDraftSessionsStore.getState().updateDraft(patch);
			if (draft.cwd !== wt.baseDir || draft.worktreeId !== wt.id) {
				useSettingsStore.getState().setLastUsedWorkspace(wt.baseDir);
			}
			navigate(`/sessions/${draft.id}`);
			return;
		}
		createDraftAndNavigate(wt.baseDir, wt.id);
	};

	// Per-group New Session. Same retarget semantics as startInCwd, with two
	// differences:
	//   - the target folder isn't the header's own identity (a group has no
	//     cwd) — it's inherited from the group's newest member, resolved by
	//     GroupSection and handed in here;
	//   - the draft is seeded with `groupId` so the row lands inside the
	//     group's box AND the real session is BORN in the group on first send
	//     (ImagePasteTextarea forwards draft.groupId to startSession).
	//     Born-with rather than set post-hoc — same rule as the handoff flow,
	//     and it means pruneGroupIfEmpty never sees a momentarily memberless
	//     group.
	// Deliberately inherits the FOLDER ONLY: no worktreeId rides along. A
	// group is an organizational bucket that can span worktrees, so copying
	// the newest member's checkout binding would be a guess, not inheritance.
	const startInGroup = (group: SessionGroup, cwd: string) => {
		setStartError(null);
		if (!cwd) return; // defensive; GroupSection hides "+" without one
		// Force the section open so the draft isn't spawned into a folded box.
		// NOT expandCwd: a group's collapse is persisted on the group record
		// (survives restart), so this is the optimistic-upsert + async-IPC
		// pair from toggleGroupCollapsed, not a local Set mutation.
		if (group.collapsed) {
			useSessionGroupsStore
				.getState()
				.upsert({ ...group, collapsed: false });
			void window.claude
				.setGroupCollapsed(group.id, false)
				.catch((err) => {
					console.error("[ccw] setGroupCollapsed failed:", err);
				});
		}
		if (draft) {
			// Same disowning rule as startInCwd/startInWorktree: a fresh "new
			// session in this group" intent must not carry a stale model
			// override or a pending handoff-delete — reset the model to the
			// app default rather than to nothing.
			const patch: {
				cwd?: string;
				worktreeId?: string;
				groupId?: string;
				model?: string;
				handoffDeleteSessionId?: string;
			} = { model: appDefaultModel(), handoffDeleteSessionId: undefined };
			// Guarded like startInCwd: a draft ALREADY in this group on this
			// folder keeps a worktree the user attached by hand in the draft
			// header. Only a genuine retarget clears the binding.
			if (draft.groupId !== group.id || draft.cwd !== cwd) {
				patch.cwd = cwd;
				patch.worktreeId = undefined;
				patch.groupId = group.id;
			}
			useDraftSessionsStore.getState().updateDraft(patch);
			if (draft.cwd !== cwd) {
				useSettingsStore.getState().setLastUsedWorkspace(cwd);
			}
			navigate(`/sessions/${draft.id}`);
			return;
		}
		createDraftAndNavigate(cwd, undefined, group.id);
	};

	// One-click shortcut/skill launch — the actual draft-slot logic lives in
	// `lib/sessionStartActions.ts` (shared with the global Cmd+K palette,
	// which triggers the same flow from outside this component). This
	// wrapper only supplies what's local to this component: the resolved
	// `targetCwd`, the "keep the new draft visible" workspace-filter
	// reveal, and clearing the sidebar's own error banner.
	const startFromShortcut = (sc: Shortcut) => {
		setStartError(null);
		return startSessionFromShortcut(sc, navigate, {
			targetCwd,
			onWorkspaceRevealed: (cwd) =>
				setWorkspaceFilter((prev) =>
					prev.length === 0 || prev.includes(cwd) ? prev : [...prev, cwd],
				),
		});
	};

	const startFromSkill = (skill: Skill) => {
		setStartError(null);
		return startSessionFromSkill(skill, navigate, {
			targetCwd,
			onWorkspaceRevealed: (cwd) =>
				setWorkspaceFilter((prev) =>
					prev.length === 0 || prev.includes(cwd) ? prev : [...prev, cwd],
				),
		});
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

	/**
	 * Is `sessionId` the sole occupant of its worktree?
	 *
	 * We can't trust `worktree.sessionIds` — main broadcasts `state:changed`
	 * skip-self when it mutates the reverse index (attach/detach), so the
	 * ORIGINATING window's copy stays stale until another push. Count from the
	 * sessions store instead, which the same window keeps authoritative via
	 * `session:started` / `session:patch` broadcasts (both delivered even to
	 * the originator).
	 *
	 * Takes an id rather than reading `pendingDeleteId` because it now runs at
	 * CLICK time, before any modal exists — it's what decides whether a modal
	 * is needed at all.
	 */
	const lastOnWorktreeId = (sessionId: string): string | undefined => {
		const worktreeId = sessions[sessionId]?.worktreeId;
		if (!worktreeId || !worktrees[worktreeId]) return undefined;
		let count = 0;
		for (const id of order) {
			if (sessions[id]?.worktreeId === worktreeId) {
				count++;
				if (count > 1) return undefined;
			}
		}
		return count === 1 ? worktreeId : undefined;
	};

	const pendingDeleteWorktreeId = pendingDeleteId
		? lastOnWorktreeId(pendingDeleteId)
		: undefined;
	const pendingDeleteWorktree = pendingDeleteWorktreeId
		? worktrees[pendingDeleteWorktreeId]
		: undefined;

	/**
	 * Entry point for the ⋯ menu's Delete item.
	 *
	 * Delete is undoable now, so the blanket "are you sure?" is gone — the undo
	 * toast is a better net than a dialog people click through on reflex, and
	 * keeping the modal would have contradicted dropping archive's for exactly
	 * the same reason.
	 *
	 * The modal survives in one case, and it isn't about the session: when this
	 * is the LAST session on a worktree, deleting it offers to destroy that
	 * checkout too. `worktreeRemove` shells out to git and then does a recursive
	 * `fs.rm`, which no in-memory buffer can undo — so that choice still gets
	 * asked about. Exactly parallel to `startArchive`, which only stops to ask
	 * when a turn is mid-flight.
	 */
	const startDelete = (sessionId: string) => {
		if (lastOnWorktreeId(sessionId)) {
			setPendingDeleteId(sessionId);
			setDeleteError(null);
			setAlsoDeleteWorktree(false);
			return;
		}
		void runDelete(sessionId, false, false);
	};

	const runDelete = async (
		targetId: string,
		cascadeWorktree: boolean,
		viaModal: boolean,
	) => {
		if (deleting) return;
		// Everything below reads from the store, which this delete is about to
		// invalidate — capture first. After `removeSession` runs, the session
		// dereferences to undefined and we lose the title and the worktree id.
		const deletedTitle = sessions[targetId]?.title ?? "session";
		const wasActive = targetId === activeSessionId;
		const cascadeWorktreeId = cascadeWorktree
			? lastOnWorktreeId(targetId)
			: undefined;
		const cascadeWorktreeName = cascadeWorktreeId
			? (worktrees[cascadeWorktreeId]?.displayName ?? "worktree")
			: "worktree";
		setDeleting(true);
		setDeleteError(null);
		try {
			const snapshot = await window.claude.deleteSession(targetId);
			removeSession(targetId);
			usePermissionsStore.getState().removeBySessionId(targetId);
			// Buffer the undo. `cascadeWorktreeId` is the honest signal for
			// `worktreeDeleted`: the checkout only dies when the user ticked
			// the box AND this was its last session, which is exactly the
			// condition that computed it. Restore uses the flag to drop the
			// worktree binding rather than hand back a chip pointing at a
			// directory that a recursive `fs.rm` already removed.
			if (snapshot) {
				pushUndo({
					kind: "delete",
					sessionId: targetId,
					title: deletedTitle,
					snapshot,
					worktreeDeleted: !!cascadeWorktreeId,
				});
			}
			// Cascade AFTER session delete: `session:delete` detaches the
			// session from `worktree.sessionIds` before returning, so by
			// the time this runs `sessionIds` is empty and the
			// `worktrees:delete` handler's "no delete while attached"
			// guard passes. Reuses the same IPC AttachWorktreeModal
			// calls, so on-disk cleanup + registry removal + skip-self
			// broadcast all behave identically.
			//
			// Handed to the background-task store rather than awaited:
			// `worktreeRemove` (main/sessions/worktrees.ts) escalates
			// through up to four git subprocesses plus a recursive rm,
			// which held this modal open for seconds.
			if (cascadeWorktreeId) {
				runBackgroundTask({
					label: `Deleting worktree ${cascadeWorktreeName}`,
					run: () => window.claude.deleteWorktree(cascadeWorktreeId),
					// Only prune the local cache on success: main KEEPS the
					// registry entry when on-disk cleanup fails so the user
					// can retry from AttachWorktreeModal.
					onSuccess: () =>
						useWorktreesStore.getState().remove(cascadeWorktreeId),
				});
			}
			setPendingDeleteId(null);
			setAlsoDeleteWorktree(false);
			// If the deleted session was the one currently open in the right
			// pane, drop back to "/" so the right pane goes empty — otherwise
			// SessionChat would render its "Session not found." state.
			if (wasActive) navigate("/");
		} catch (err) {
			// Only the session delete can land here — the worktree cascade
			// reports its own failures through the background-task indicator.
			// Route to whichever surface the user is looking at; `viaModal` is
			// passed explicitly rather than inferred from `pendingDeleteId`,
			// which comes from the render closure and would make this depend on
			// when the function was created.
			const message = err instanceof Error ? err.message : String(err);
			if (viaModal) setDeleteError(message);
			else setStartError(`Couldn't delete: ${message}`);
		} finally {
			setDeleting(false);
		}
	};

	const confirmDelete = () => {
		if (!pendingDeleteId) return;
		void runDelete(pendingDeleteId, alsoDeleteWorktree, true);
	};

	const cancelDelete = () => {
		if (deleting) return;
		setPendingDeleteId(null);
		setDeleteError(null);
		setAlsoDeleteWorktree(false);
	};

	const worktreeName = pendingDeleteWorktree?.displayName ?? "this worktree";

	// Only ever open when the session is the LAST one on a worktree —
	// `startDelete` deletes anything else outright. So the copy is about the
	// worktree decision, not about the session: the session half is undoable
	// and no longer worth a dialog, while a destroyed checkout is gone.
	const deleteModal = (
		<ConfirmModal
			open={!!pendingDeleteId}
			title="Delete session?"
			message={
				<>
					Deleting{" "}
					<strong>{pendingDeleteSession?.title ?? "this session"}</strong>{" "}
					leaves worktree <strong>{worktreeName}</strong> with no sessions.
					{pendingDeleteWorktree ? (
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
					{/* The session itself is undoable; the worktree is not —
					    `worktreeRemove` shells out to git and then does a
					    recursive `fs.rm`. Shown only once the box is actually
					    ticked, so the modal isn't shouting at someone who just
					    wants the session gone. Deliberately does NOT advertise
					    that the session half is undoable: a confirm dialog that
					    reassures you is a confirm dialog people stop reading. */}
					{pendingDeleteWorktree && alsoDeleteWorktree ? (
						<div
							style={{
								marginTop: 6,
								marginLeft: 22,
								fontSize: 12,
								lineHeight: 1.45,
								color: T.textMute,
							}}
						>
							The worktree is deleted from disk and can't be restored.
						</div>
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

	const runArchive = async (targetId: string, viaModal: boolean) => {
		if (archiving) return;
		// Capture before the async work — the routing decision below has to be
		// made against the session that was active when we started.
		const wasActive = targetId === activeSessionId;
		const archivedTitle = sessions[targetId]?.title ?? "session";
		setArchiving(true);
		setArchiveError(null);
		try {
			await window.claude.archiveSession(targetId);
			// Archive needs no snapshot: the record never leaves disk, so
			// undoing it is a plain `unarchiveSession` call. `kind: "archive"`
			// is what tells `restoreEntry` to take that cheaper path.
			pushUndo({
				kind: "archive",
				sessionId: targetId,
				title: archivedTitle,
				snapshot: null,
				worktreeDeleted: false,
			});
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
			const message = err instanceof Error ? err.message : String(err);
			// Route the failure to whichever surface the user is actually
			// looking at. `viaModal` is passed explicitly rather than inferred
			// from `pendingArchiveId`: that value comes from the render
			// closure, so reading it here would silently depend on when this
			// async function was created.
			if (viaModal) setArchiveError(message);
			else setStartError(`Couldn't archive: ${message}`);
		} finally {
			setArchiving(false);
		}
	};

	/**
	 * Entry point for the ⋯ menu's Archive item.
	 *
	 * Archive used to always raise a confirm modal, which had the safety
	 * backwards: archiving is fully reversible (unarchive just clears
	 * `archivedAt`, and already runs with no confirmation at all), while the
	 * genuinely destructive action next to it in the same menu is the one that
	 * needed a net. So archive is now immediate, and the undo toast is what
	 * catches a misclick.
	 *
	 * The one surviving confirm has nothing to do with reversibility: archiving
	 * a session mid-turn CANCELS that turn and rejects its pending permission
	 * prompts, and unarchiving does not resume it. That's real work thrown
	 * away, so it still gets asked about.
	 */
	const startArchive = (sessionId: string) => {
		const status = sessions[sessionId]?.status;
		if (status === "running" || status === "awaiting_permission") {
			setPendingArchiveId(sessionId);
			setArchiveError(null);
			return;
		}
		void runArchive(sessionId, false);
	};

	const confirmArchive = () => {
		if (!pendingArchiveId) return;
		void runArchive(pendingArchiveId, true);
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

	// Ungrouped rows render under subtle per-cwd (or per-worktree) headers;
	// each group renders into its own bordered wrapper (header + member rows
	// share one framed block, colored on every side by the group's border
	// token). Session
	// rows inside a group live under a different DOM parent than ungrouped
	// ones, so moving a row between the two remounts it — an acceptable
	// cost for the framed look; session cards hold only trivial local
	// state (menu open).
	const sidebarRows = useMemo<SidebarRow[]>(() => {
		const rows: SidebarRow[] = [];
		// Every cwd bucket is boxed, including a lone one — the folder header
		// is a fixed part of the sidebar's vocabulary rather than something
		// that appears only once a second folder shows up. Worktree buckets
		// were always boxed and are unchanged.
		for (const bucket of ungroupedBuckets) {
			if (bucket.kind === "cwd") {
				rows.push({
					kind: "cwdBucket",
					cwd: bucket.cwd,
					ids: bucket.ids,
					collapsed: collapsedCwds.has(bucket.cwd),
				});
			} else {
				rows.push({
					kind: "worktreeBucket",
					worktree: bucket.worktree,
					ids: bucket.ids,
					collapsed: collapsedCwds.has(`wt:${bucket.worktree.id}`),
					label: worktreeBucketLabel(bucket.worktree, hideCwdPrefix),
				});
			}
		}
		for (const section of groupSections) {
			rows.push({ kind: "group", section });
		}
		return rows;
	}, [ungroupedBuckets, groupSections, collapsedCwds, hideCwdPrefix]);

	// Where the draft row renders. A draft spawned from a bucket's or a
	// group's "+" (or retargeted into one) lands as the FIRST row inside that
	// container — next to the affordance the user just clicked, and matching
	// newest-first ordering. Precedence mirrors the real-session partition
	// above: group > worktree > cwd. Falls back to the top of the list when
	// no matching container is rendered (a folder with no sessions yet, or a
	// group that auto-deleted out from under the draft).
	const draftHost = useMemo<
		| { kind: "top" }
		| { kind: "group"; id: string }
		| { kind: "cwd"; cwd: string }
		| { kind: "worktree"; id: string }
	>(() => {
		if (!draft) return { kind: "top" };
		if (
			draft.groupId &&
			sidebarRows.some(
				(r) =>
					r.kind === "group" &&
					r.section.group.id === draft.groupId,
			)
		) {
			return { kind: "group", id: draft.groupId };
		}
		if (
			draft.worktreeId &&
			sidebarRows.some(
				(r) =>
					r.kind === "worktreeBucket" &&
					r.worktree.id === draft.worktreeId,
			)
		) {
			return { kind: "worktree", id: draft.worktreeId };
		}
		if (
			sidebarRows.some(
				(r) => r.kind === "cwdBucket" && r.cwd === draft.cwd,
			)
		) {
			return { kind: "cwd", cwd: draft.cwd };
		}
		return { kind: "top" };
	}, [draft, sidebarRows]);

	const renderDraftRow = (last: boolean) =>
		draft ? (
			<DraftRowSidebar
				key={draft.id}
				draft={draft}
				active={draft.id === activeSessionId}
				last={last}
				onDiscard={() => discardDraft(draft.id)}
			/>
		) : null;

	// Shared renderer for ungrouped session rows. Always inside a cwd or
	// worktree box, so the per-row cwd footer is suppressed — the bucket
	// header already names the folder. (Group members keep their footer:
	// a group can span folders, so its rows still need the label.)
	const renderSessionRow = (id: string, last: boolean) => {
		const s = sessions[id];
		const sessionPending = queue.filter((q) => q.sessionId === id);
		return (
			<SessionRowSidebar
				key={id}
				session={s}
				last={last}
				hideCwd
				pending={sessionPending}
				active={id === activeSessionId}
				onDelete={() => startDelete(id)}
				onArchive={() => startArchive(id)}
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

	// Only ever open for a session that's mid-turn — `startArchive` archives
	// idle sessions outright. So the copy is about the turn being thrown away,
	// not about hiding a row: hiding is reversible and needs no dialog, while
	// a cancelled turn is not resumed by unarchiving.
	const archiveModal = (
		<ConfirmModal
			open={!!pendingArchiveId}
			title="Archive session?"
			message={
				<>
					<strong>
						{pendingArchiveSession?.title ?? "This session"}
					</strong>{" "}
					is still working. Archiving stops the turn in progress and
					unarchiving won't resume it.
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
					<ShortcutsMenuButton
						buttonClassName="btn"
						buttonStyle={{ width: 32, padding: 0 }}
						onRun={(sc) => void startFromShortcut(sc)}
						onRunSkill={(skill) => void startFromSkill(skill)}
					/>
				</div>
				{showFilterRow ? (
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
							onToggleArchived={() => setShowArchived((v) => !v)}
							onOpenSettings={() => setSettingsOpen(true)}
							onOpenRecentlyDeleted={() => setRecentlyDeletedOpen(true)}
							recentlyDeletedCount={undoEntries.length}
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
						{draftHost.kind === "top"
							? renderDraftRow(sidebarRows.length === 0)
							: null}
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
											onNewSession={() =>
												startInCwd(row.cwd)
											}
										/>
										{!row.collapsed &&
										draftHost.kind === "cwd" &&
										draftHost.cwd === row.cwd
											? renderDraftRow(row.ids.length === 0)
											: null}
										{row.collapsed
											? null
											: row.ids.map((id, i) =>
												renderSessionRow(
													id,
													i === row.ids.length - 1,
												),
											)}
									</div>
								);
							}
							if (row.kind === "worktreeBucket") {
								return (
									<div
										key={`wt:${row.worktree.id}`}
										style={{
											// Same recessed dark box as the cwd
											// buckets — worktrees are the neutral
											// sibling of GroupSection too, just
											// keyed by worktree instead of folder.
											margin: "8px 0",
											background: T.bg,
											borderTop: `1px solid ${T.borderSoft}`,
											overflow: "hidden",
										}}
									>
										<CwdHeaderRow
											cwd={row.worktree.baseDir}
											label={row.label}
											collapsed={row.collapsed}
											onToggle={() =>
												toggleCwdCollapsed(
													`wt:${row.worktree.id}`,
												)
											}
											onNewSession={() =>
												startInWorktree(row.worktree)
											}
										/>
										{!row.collapsed &&
										draftHost.kind === "worktree" &&
										draftHost.id === row.worktree.id
											? renderDraftRow(row.ids.length === 0)
											: null}
										{row.collapsed
											? null
											: row.ids.map((id, i) =>
												renderSessionRow(
													id,
													i === row.ids.length - 1,
												),
											)}
									</div>
								);
							}
							const { group, ids } = row.section;
							return (
								<GroupSection
									key={`group:${group.id}`}
									group={group}
									ids={ids}
									sessions={sessions}
									queue={queue}
									activeSessionId={activeSessionId}
									onToggleCollapsed={() =>
										toggleGroupCollapsed(group)
									}
									onNewSession={(cwd) =>
										startInGroup(group, cwd)
									}
									// `last={false}`: a rendered group
									// section always has >=1 member row
									// beneath the draft, so the draft
									// never owns the box's final hairline.
									draftSlot={
										draftHost.kind === "group" &&
										draftHost.id === group.id
											? renderDraftRow(false)
											: null
									}
									onRename={(id) =>
										setPendingRenameGroupId(id)
									}
									onDelete={(id) => startDelete(id)}
									onArchive={(id) => startArchive(id)}
									onUnarchive={(id) => void unarchive(id)}
									onAddToGroup={(id) =>
										setPendingGroupSessionId(id)
									}
									onRemoveFromGroup={(id) =>
										void removeFromGroup(id)
									}
								/>
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
			<SettingsModal
				open={settingsOpen}
				onClose={() => setSettingsOpen(false)}
			/>
			<RecentlyDeletedModal
				open={recentlyDeletedOpen}
				onClose={() => setRecentlyDeletedOpen(false)}
			/>
		</div>
	);
}

/** One ungrouped bucket before it becomes sidebar rows: either a cwd's
 * plain sessions or a worktree's bound sessions. Sorted as one list by
 * full display label — see the grouping memo. */
type UngroupedBucket =
	| { kind: "cwd"; cwd: string; ids: string[] }
	| { kind: "worktree"; worktree: Worktree; ids: string[] };

/** One entry in the sidebar's top-level render sequence. */
type SidebarRow =
	/** One cwd's worth of ungrouped sessions, rendered as a recessed dark
	 * box (header + member rows). Always boxed, even for a lone cwd. */
	| { kind: "cwdBucket"; cwd: string; ids: string[]; collapsed: boolean }
	/** One worktree's worth of sessions — same recessed box as cwdBucket,
	 * labeled "folder: worktree" (bare worktree name when only one folder
	 * is visible). */
	| {
		kind: "worktreeBucket";
		worktree: Worktree;
		ids: string[];
		collapsed: boolean;
		label: string;
	}
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

	// A live sidequest surfaces through its parent's row: the sidequest has no
	// sidebar presence of its own, so this pill is the only place its activity
	// is visible once you navigate away. Primitive selectors (never the state
	// object) so streaming sidequest messages don't re-render every row.
	// Sidequest permission requests are keyed by the *sidequest* id, which the
	// row's own `pending` filter (keyed by session id) can never match.
	const sqStatus = useSidequestsStore(
		(s) => s.byParent[session.id]?.status,
	);
	const sqId = useSidequestsStore(
		(s) => s.byParent[session.id]?.sidequestId,
	);
	const sqHasPending = usePermissionsStore(
		(s) => sqId != null && s.queue.some((q) => q.sessionId === sqId),
	);
	const sqRunning = sqStatus === "running" || sqStatus === "starting";

	// Waiting (either thread) beats running beats everything else — same
	// precedence the main session already applies to itself.
	const status =
		hasPending || sqHasPending
			? "awaiting_permission"
			: session.status !== "running" && sqRunning
				? "running"
				: session.status;

	return {
		hasPending,
		summary,
		unread,
		status,
	};
}

function SessionRowSidebar({
	session,
	last,
	pending,
	active,
	inGroup = false,
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
	/** True when the row renders inside a group's section — same recessed
	 * chassis as a cwd/worktree bucket row, plus the grouped ⋯ menu options.
	 * Also the source of truth for the menu's grouped state: a dangling
	 * groupId renders (and behaves) as ungrouped. */
	inGroup?: boolean;
	onDelete: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
	onAddToGroup: () => void;
	onRemoveFromGroup: () => void;
}) {
	const { summary, unread, status } = useRowDerived(
		session,
		pending,
	);
	const markUnread = useReadStore((s) => s.markUnread);
	const archived = session.archivedAt != null;
	// One-shot accent wash right after this row was restored by undo. The row
	// returns to its original recency slot, which in a long sidebar is easily
	// off-screen or lost among neighbours — navigation proves the restore
	// worked, this shows WHERE it landed. Reads unambiguously because rows have
	// no hover background, so a transient tint can't be a pointer artifact.
	const restored = useUndoStore((s) => s.flashSessionId) === session.id;
	const rowRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!restored) return;
		rowRef.current?.scrollIntoView({ block: "nearest" });
	}, [restored]);
	return (
		<div
			ref={rowRef}
			className={restored ? "session-row-restored" : undefined}
			style={{
				borderBottom: last ? "none" : `0.5px solid ${T.borderSoft}`,
				// Only highlight the active row. Pending state is conveyed by the
				// "waiting for input" StatusPill and the count badge below.
				// The fill is a translucent color-mix, never a fixed surface
				// token: a row can sit on the pane (T.win) or on a recessed
				// cwd/worktree/group bucket (T.bg), and the selection has to
				// lift *relative* to whichever is behind it. A flat
				// T.surfaceHi over-shot inside the dark bucket and came out
				// lighter than the pane framing it, so the highlight read as
				// a foreign grey block floating out of its own box.
				background: active ? ROW_SELECTED_BG : "transparent",
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
					{/* Title row. (No per-row worktree chip: worktree sessions
					    render inside their own sidebar bucket, whose header
					    already names the worktree.) */}
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
								aria-label="Unread"
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
					{/* Chips row — status + branch pair. */}
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							alignItems: "center",
							gap: 6,
							minWidth: 0,
						}}
					>
						{/* `status` folds in sidequest activity (running / waiting)
						    on top of the session's own state — see useRowDerived. */}
						<StatusPill
							status={status}
							mode={session.mode}
							pendingToolName={pending[0]?.toolName}
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
 * Framed container for a single custom group. Deliberately the same
 * recessed-well chassis as the cwd/worktree buckets below (T.bg fill, one
 * top hairline, no rounding) — the two section kinds should read as one
 * component family. The only place group identity shows is the header's
 * title color; see `GroupHeaderRow`. Header sits at the top, followed by
 * member rows (when expanded).
 */
function GroupSection({
	group,
	ids,
	sessions,
	queue,
	activeSessionId,
	onToggleCollapsed,
	onNewSession,
	draftSlot,
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
	activeSessionId?: string;
	onToggleCollapsed: () => void;
	/** New Session in this group. The folder is resolved HERE rather than by
	 * the caller because it's a property of the group's membership: the cwd
	 * of the group's newest member. `ids` comes from `visibleOrder`, so it's
	 * already newest-first — ids[0] is the most recent member. */
	onNewSession: (cwd: string) => void;
	/** The draft row, when this group is its host. A slot rather than
	 * draft/activeSessionId/onDiscard props, so the draft's wiring stays in
	 * SessionsList next to the cwd and worktree buckets that do the same. */
	draftSlot?: React.ReactNode;
	onRename: (groupId: string) => void;
	onDelete: (id: string) => void;
	onArchive: (id: string) => void;
	onUnarchive: (id: string) => void;
	onAddToGroup: (id: string) => void;
	onRemoveFromGroup: (id: string) => void;
}) {
	// Folder the header's "+" targets: the newest member's cwd. The walk past
	// a member with no cwd is belt-and-braces — a group can never be empty
	// (main auto-deletes at zero members via pruneGroupIfEmpty), so this all
	// but always resolves on the first entry. When nothing resolves, the
	// header renders no "+" at all rather than a dead one.
	const newSessionCwd = ids
		.map((id) => sessions[id]?.cwd)
		.find((cwd): cwd is string => !!cwd);
	return (
		<div
			style={{
				// Same recessed dark box as the cwd/worktree buckets — see
				// the comment on those wrapping divs in the sidebar's
				// render map. Rows render transparent, so T.bg shows
				// through the full section.
				margin: "8px 0",
				background: T.bg,
				borderTop: `1px solid ${T.borderSoft}`,
				overflow: "hidden",
			}}
		>
			<GroupHeaderRow
				group={group}
				onToggle={onToggleCollapsed}
				onNewSession={
					newSessionCwd
						? () => onNewSession(newSessionCwd)
						: undefined
				}
				onRename={() => onRename(group.id)}
			/>
			{group.collapsed ? null : draftSlot}
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
 * subordinate to real groups.
 */
function CwdHeaderRow({
	cwd,
	label,
	collapsed,
	onToggle,
	onNewSession,
}: {
	cwd: string;
	/** Display override — worktree buckets pass "folder: worktree" (or the
	 * bare worktree name) here; cwd buckets omit it and derive from `cwd`. */
	label?: string;
	collapsed: boolean;
	onToggle: () => void;
	onNewSession: () => void;
}) {
	const name = label ?? (folderName(cwd) || cwd);
	return (
		// A flex ROW, not a single button: the "+" must be a sibling of the
		// toggle, never a descendant (nested <button> is invalid HTML, and a
		// nested click target would need stopPropagation to avoid also
		// collapsing the bucket). The wrapper owns the under-rule so it spans
		// the full width, including behind the "+".
		<div
			style={{
				display: "flex",
				alignItems: "center",
				borderBottom: collapsed
					? "none"
					: `0.5px solid ${T.borderSoft}`,
				// 2px + the 24px button's 12px half-width puts the glyph's
				// center 14px from the box edge — the same optical column as
				// the rows' ⋯ button (row padding 14 + RowMenuButton's
				// marginRight -12).
				paddingRight: 2,
			}}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={!collapsed}
				style={{
					appearance: "none",
					flex: 1,
					minWidth: 0,
					display: "flex",
					alignItems: "center",
					gap: 7,
					padding: "9px 12px",
					// The wrapping bucket box owns the dark fill; the header
					// just splits itself from the first member row with a
					// hairline when expanded (GroupHeaderRow's move).
					background: "transparent",
					border: "none",
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
					{label ?? (folderName(cwd) || cwd || "no folder")}
				</span>
			</button>
			{/* No "+" for the synthetic "" bucket (sessions with a null cwd):
			    there is no folder to target. */}
			{cwd ? (
				<button
					type="button"
					onClick={onNewSession}
					aria-label={`New session in ${name}`}
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
						width: 24,
						height: 24,
						padding: 0,
						border: "none",
						borderRadius: 4,
						background: "transparent",
						color: T.textFaint,
						cursor: "pointer",
					}}
					// Relative lift, not T.surfaceHi: this button sits directly
					// on the bucket's recessed T.bg, where a fixed surface token
					// would flare brighter than the pane around the box.
					onMouseEnter={(e) => {
						e.currentTarget.style.background = ROW_SELECTED_BG;
						e.currentTarget.style.color = T.text;
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "transparent";
						e.currentTarget.style.color = T.textFaint;
					}}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden
					>
						<path
							d="M7 3v8M3 7h8"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			) : null}
		</div>
	);
}

function GroupHeaderRow({
	group,
	onToggle,
	onNewSession,
	onRename,
}: {
	group: SessionGroup;
	onToggle: () => void;
	/** Omitted when no member has a cwd — the header then renders no "+" at
	 * all rather than a button with nothing to target. */
	onNewSession?: () => void;
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
			{/* A flex ROW, not a single button: the "+" must be a sibling of
			    the toggle, never a descendant (nested <button> is invalid
			    HTML, and a nested click target would need stopPropagation to
			    avoid also collapsing the group). Same restructure CwdHeaderRow
			    carries. The wrapper owns the under-rule so it spans the full
			    width including behind the "+", and owns the context menu so
			    right-click works across the whole strip — dead right-click
			    zones would be worse than the button-only version this
			    replaces. `contextmenu` bubbles up from the "+", so no
			    stopPropagation is needed anywhere. */}
			<div
				onContextMenu={(e) => {
					e.preventDefault();
					setMenuPos({ x: e.clientX, y: e.clientY });
				}}
				style={{
					display: "flex",
					alignItems: "center",
					// Bottom hairline appears only when expanded, splitting the
					// header from the first member row; collapsed headers stand
					// alone inside the bordered box.
					borderBottom: group.collapsed
						? "none"
						: `0.5px solid ${T.borderSoft}`,
					// 2px + the 24px button's 12px half-width puts the glyph's
					// center 14px from the box edge — the same optical column
					// as the rows' ⋯ button. Matches CwdHeaderRow.
					paddingRight: 2,
				}}
			>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={!group.collapsed}
					style={{
						appearance: "none",
						flex: 1,
						minWidth: 0,
						display: "flex",
						alignItems: "center",
						gap: 7,
						padding: "9px 12px",
						border: "none",
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
					{/* Group color lives on the name itself (no separate dot,
					    no count, no aggregate pills — otherwise identical to
					    CwdHeaderRow's label). Muted to header weight (mixed
					    toward T.textMute, landing near T.textDim) rather than
					    the raw palette color: a container label should read
					    quieter than the session titles inside it, and full
					    saturation right next to a neutral folder label read
					    as a louder, unrelated widget. Don't put this back to
					    c.fg. */}
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							letterSpacing: 0.5,
							textTransform: "uppercase",
							color: `color-mix(in oklab, ${c.fg} 60%, ${T.textMute})`,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							minWidth: 0,
						}}
					>
						{group.name}
					</span>
				</button>
				{/* No "+" when no member carries a cwd — there'd be no folder
				    to target. Mirrors CwdHeaderRow's `{cwd ? … : null}`. */}
				{onNewSession ? (
					<button
						type="button"
						onClick={onNewSession}
						aria-label={`New session in ${group.name}`}
						style={{
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
							width: 24,
							height: 24,
							padding: 0,
							border: "none",
							borderRadius: 4,
							background: "transparent",
							color: T.textFaint,
							cursor: "pointer",
						}}
						// Rests neutral (T.textFaint) like the chevron — the
						// name is the group's only colored element. Hover
						// matches CwdHeaderRow's neutral lift rather than the
						// group's own hue, so the "+" reads as the same
						// pointer affordance in both section kinds.
						onMouseEnter={(e) => {
							e.currentTarget.style.background = ROW_SELECTED_BG;
							e.currentTarget.style.color = T.text;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "transparent";
							e.currentTarget.style.color = T.textFaint;
						}}
					>
						<svg
							width="13"
							height="13"
							viewBox="0 0 14 14"
							fill="none"
							aria-hidden
						>
							<path
								d="M7 3v8M3 7h8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				) : null}
			</div>
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
				// Same relative lift as SessionRowSidebar — a draft row can land
				// inside a recessed cwd/worktree/group bucket too.
				background: active ? ROW_SELECTED_BG : "transparent",
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
				aria-label="More actions"
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					border: "none",
					// Relative lift, not T.surfaceHi — the row under this button
					// may be a recessed bucket's T.bg, where a fixed surface
					// token flares brighter than the row it sits on.
					background: open ? ROW_SELECTED_BG : "transparent",
					color: open ? T.text : T.textFaint,
					cursor: "pointer",
					borderRadius: 4,
					padding: 0,
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = ROW_SELECTED_BG;
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
	mono,
	danger,
	checkbox,
	onClick,
}: {
	active: boolean;
	label: string;
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
 * Sidebar overflow-options dropdown. Visually a 32×32 icon button matching
 * FolderButton — stacks below it as the right-edge control of the second
 * header row, with the WorkspaceFilter taking the remaining width on the
 * left. Exposes a toggle for "Show archived sessions" / "Hide archived
 * sessions" plus "Settings". Sized as a dropdown rather than an inline
 * button so future view controls can land here without crowding the
 * header.
 *
 * `alignRight` pushes the button to the right edge when there's no
 * WorkspaceFilter sharing the row — keeps it stacked under FolderButton
 * regardless of what else is rendered.
 */
function ViewOptionsButton({
	showArchived,
	onToggleArchived,
	onOpenSettings,
	onOpenRecentlyDeleted,
	recentlyDeletedCount,
	alignRight,
}: {
	showArchived: boolean;
	onToggleArchived: () => void;
	onOpenSettings: () => void;
	onOpenRecentlyDeleted: () => void;
	recentlyDeletedCount: number;
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
				aria-label="View options"
				style={{ width: 32, padding: 0, color: T.textDim }}
			>
				{/* Kebab (more options) icon — the menu now mixes an archived-
				    visibility toggle with unrelated items (Settings), so an
				    eye (which implied "the only option here is visibility")
				    no longer fits. Three dots reads as a generic overflow
				    menu regardless of what lands in it next. */}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<circle cx="7" cy="2.5" r="1.15" fill="currentColor" />
					<circle cx="7" cy="7" r="1.15" fill="currentColor" />
					<circle cx="7" cy="11.5" r="1.15" fill="currentColor" />
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
					{/* The undo toast is gone in 8s and Shift+Cmd+Z is invisible,
					    so without this nothing on screen would ever suggest a
					    deleted session is still recoverable. Hidden entirely at
					    zero, so it only appears when it has something to offer. */}
					{recentlyDeletedCount > 0 ? (
						<MenuItem
							active={false}
							label={`Recently deleted (${recentlyDeletedCount})`}
							onClick={() => {
								setOpen(false);
								onOpenRecentlyDeleted();
							}}
						/>
					) : null}
					<MenuItem
						active={false}
						label="Settings"
						onClick={() => {
							setOpen(false);
							onOpenSettings();
						}}
					/>
				</div>
			) : null}
		</div>
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
				aria-label="More actions"
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

/** Header label for a worktree bucket: "folder: worktree", or the bare
 * worktree name when only one distinct folder is visible in the sidebar
 * (the prefix would be pure noise). */
function worktreeBucketLabel(wt: Worktree, hidePrefix: boolean): string {
	return hidePrefix
		? wt.displayName
		: `${folderName(wt.baseDir)}: ${wt.displayName}`;
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
