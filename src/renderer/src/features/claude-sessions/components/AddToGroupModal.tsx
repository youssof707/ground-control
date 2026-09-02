import { useCallback, useEffect, useMemo, useState } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { WORKTREE_COLOR_MAP } from "../../../design/WorktreeChip";
import { ColorPicker, LabeledInput } from "../../../design/FormControls";
import type { WorktreeColor } from "@shared/schemas/worktrees";
import type { SessionGroup } from "@shared/schemas/session_groups";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";
import { useSessionsStore } from "../stores/useSessionsStore";

/**
 * Modal for filing a session into a sidebar group. Mirrors the
 * AttachWorktreeModal layout (same `modal-backdrop` / `modal-card` /
 * `modal-title` / `modal-actions` / `modal-error` CSS classes) but is far
 * simpler — no git, no fetching: groups come straight from
 * `useSessionGroupsStore`, which the bootstrap keeps hydrated.
 *
 * Two sections:
 *   1. Existing groups — single click to join and close.
 *   2. Create a new group (name required + color) — creates, joins, closes.
 *
 * Open ⇔ `sessionId != null`, matching the pendingDeleteId/pendingArchiveId
 * pattern SessionsList already uses for its other modals.
 */
export function AddToGroupModal({
	sessionId,
	onClose,
}: {
	sessionId: string | null;
	onClose: () => void;
}) {
	const open = sessionId != null;
	const groups = useSessionGroupsStore((s) => s.groups);
	const sessions = useSessionsStore((s) => s.sessions);

	const [name, setName] = useState("");
	const [color, setColor] = useState<WorktreeColor>("blue");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset form state on every open so a stale name/error can't leak
	// across two consecutive opens (mirrors AttachWorktreeModal).
	useEffect(() => {
		if (!open) return;
		setName("");
		setColor("blue");
		setBusy(false);
		setError(null);
	}, [open, sessionId]);

	// Escape closes.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	// Newest-first, matching the sidebar's section order so the modal list
	// and the sidebar read identically. Ulid tie-break for same-ms creates.
	const sortedGroups = useMemo(() => {
		return Object.values(groups).sort(
			(a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
		);
	}, [groups]);

	// Member counts for the row's faint "N sessions" label. Derived from
	// the sessions store — membership lives on session.groupId only.
	const memberCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const s of Object.values(sessions)) {
			if (s.groupId) counts[s.groupId] = (counts[s.groupId] ?? 0) + 1;
		}
		return counts;
	}, [sessions]);

	const handleJoinExisting = useCallback(
		async (groupId: string) => {
			if (!sessionId || busy) return;
			setBusy(true);
			setError(null);
			try {
				await window.claude.setSessionGroup(sessionId, groupId);
				onClose();
			} catch (err) {
				// Covers the "group auto-deleted from another window while
				// the modal sat open" race — the un-skipped prune broadcast
				// re-hydrates the store and the stale row disappears.
				setError((err as Error).message || "Failed to add to group");
				setBusy(false);
			}
		},
		[sessionId, busy, onClose],
	);

	const canCreate = !busy && name.trim().length > 0;

	const handleCreate = useCallback(async () => {
		if (!sessionId || !canCreate) return;
		setBusy(true);
		setError(null);
		try {
			const g = await window.claude.createGroup({
				name: name.trim(),
				color,
			});
			// Hydrate the local groups store immediately: main's
			// `state:changed` is skip-self, so without this upsert the
			// originating window's sidebar would render the member row
			// before its group header exists.
			useSessionGroupsStore.getState().upsert(g);
			await window.claude.setSessionGroup(sessionId, g.id);
			onClose();
		} catch (err) {
			setError((err as Error).message || "Failed to create group");
			setBusy(false);
		}
	}, [sessionId, canCreate, name, color, onClose]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="add-to-group-title"
				style={{ width: "min(440px, calc(100vw - 32px))" }}
			>
				<h2 id="add-to-group-title" className="modal-title">
					Add to group
				</h2>

				{sortedGroups.length > 0 ? (
					<Section title="Existing groups">
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 4,
							}}
						>
							{sortedGroups.map((g) => (
								<GroupRow
									key={g.id}
									group={g}
									count={memberCounts[g.id] ?? 0}
									disabled={busy}
									onClick={() => void handleJoinExisting(g.id)}
								/>
							))}
						</div>
					</Section>
				) : null}

				<Section
					title={
						sortedGroups.length > 0
							? "Or create a new group"
							: "New group"
					}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 10,
						}}
					>
						<LabeledInput
							label="Name"
							value={name}
							onChange={setName}
							autoFocus
							disabled={busy}
							maxLength={60}
							mono={false}
							onEnter={handleCreate}
						/>
						<ColorPicker
							value={color}
							onChange={setColor}
							disabled={busy}
							label="Color"
						/>
					</div>
				</Section>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button
						className="btn btn-primary"
						disabled={!canCreate}
						onClick={() => void handleCreate()}
					>
						{busy ? "…" : "Create & add"}
					</button>
				</div>
			</div>
		</div>
	);
}

// Duplicated from AttachWorktreeModal on purpose — 8 trivial lines, not
// worth a shared module (unlike LabeledInput/ColorPicker, which moved to
// design/FormControls.tsx when this file became their second consumer).
function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div style={{ marginBottom: 16 }}>
			<div
				style={{
					fontSize: 10.5,
					fontWeight: 600,
					letterSpacing: 0.6,
					textTransform: "uppercase",
					color: T.textMute,
					marginBottom: 8,
				}}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

/**
 * One clickable existing-group row: color dot, name, faint member count.
 * Modeled on AttachWorktreeModal's ExistingRow, minus the delete button
 * (groups auto-delete at zero members, so there's nothing to manage here).
 */
function GroupRow({
	group,
	count,
	disabled,
	onClick,
}: {
	group: SessionGroup;
	count: number;
	disabled?: boolean;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	const c = WORKTREE_COLOR_MAP[group.color];
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				appearance: "none",
				textAlign: "left",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 10px",
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: hover ? T.surfaceHi : T.surface,
				color: T.text,
				cursor: disabled ? "not-allowed" : "pointer",
				fontSize: 12.5,
				opacity: disabled ? 0.6 : 1,
				transition: "background 80ms ease, border-color 80ms ease",
				outline: "none",
			}}
		>
			<span
				aria-hidden
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: c.fg,
					flexShrink: 0,
				}}
			/>
			<span
				style={{
					fontWeight: 600,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
					flex: 1,
				}}
			>
				{group.name}
			</span>
			<span
				style={{
					fontSize: 11,
					color: T.textMute,
					flexShrink: 0,
				}}
			>
				{count} session{count === 1 ? "" : "s"}
			</span>
		</button>
	);
}
