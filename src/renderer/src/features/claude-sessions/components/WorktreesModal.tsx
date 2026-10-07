import { useCallback, useEffect, useMemo, useState } from "react";
import { T } from "../../../design/tokens";
import { WORKTREE_COLOR_MAP } from "../../../design/WorktreeChip";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import type { Worktree } from "@shared/schemas/worktrees";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { DeleteWorktreeButton } from "./AttachWorktreeModal";

/**
 * App-wide worktree inventory, opened from "Worktrees" in the sidebar's
 * view-options menu.
 *
 * Until now the only place to see or delete a worktree was the attach modal
 * on a draft session, which scopes itself to one baseDir and exists to
 * attach — so an orphaned worktree in a repo you're not currently drafting
 * in was invisible. This is the read-and-prune surface: every worktree,
 * grouped by base repo, with the same trash affordance the attach modal
 * uses. No create here; creation stays where the worktree gets attached.
 *
 * Delete is only offered at zero sessions. Main's `worktrees.remove`
 * refuses otherwise, and the fix for an in-use worktree is to delete its
 * sessions (which can cascade-delete the worktree), not to pull it out
 * from under them.
 */
export function WorktreesModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const worktrees = useWorktreesStore((s) => s.worktrees);
	const [error, setError] = useState<string | null>(null);
	const backdropProps = useBackdropDismiss(onClose);

	// Refresh the store on open. It's already kept current by boot hydrate +
	// `state:changed` + the local upsert/remove calls, so this is belt and
	// braces — but a stale row here would mean a confusing "can't delete"
	// error, and the fetch is cheap.
	useEffect(() => {
		if (!open) return;
		setError(null);
		void (async () => {
			try {
				const list = await window.claude.listWorktrees();
				useWorktreesStore.getState().hydrate(list);
			} catch (err) {
				console.error("[ccw] WorktreesModal fetch failed:", err);
			}
		})();
	}, [open]);

	// Same window-level Escape handling as RecentlyDeletedModal / SettingsModal.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	// Group by baseDir so a repo with several worktrees reads as one block.
	// Repos sort by folder name, worktrees within a repo by creation time so
	// the list is stable across opens (a name sort would jump rows on rename
	// if that ever lands).
	const groups = useMemo(() => {
		const byBase = new Map<string, Worktree[]>();
		for (const wt of Object.values(worktrees)) {
			const list = byBase.get(wt.baseDir);
			if (list) list.push(wt);
			else byBase.set(wt.baseDir, [wt]);
		}
		return Array.from(byBase.entries())
			.map(([baseDir, items]) => ({
				baseDir,
				items: items.sort((a, b) => a.createdAt - b.createdAt),
			}))
			.sort((a, b) =>
				folderName(a.baseDir).localeCompare(folderName(b.baseDir)),
			);
	}, [worktrees]);

	// Local `remove` mirrors AttachWorktreeModal: main's `state:changed`
	// broadcast is skip-self, so the originating window has to drop the row
	// itself or it lingers until the next hydrate.
	const handleDelete = useCallback(async (id: string) => {
		setError(null);
		try {
			await window.claude.deleteWorktree(id);
			useWorktreesStore.getState().remove(id);
		} catch (err) {
			setError((err as Error).message || "Failed to delete worktree");
		}
	}, []);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="worktrees-title"
				style={{ width: "min(520px, calc(100vw - 32px))" }}
			>
				<h2 id="worktrees-title" className="modal-title">
					Worktrees
				</h2>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 14,
						maxHeight: 400,
						overflowY: "auto",
						margin: "12px 0",
					}}
				>
					{groups.length === 0 ? (
						<div
							style={{
								fontSize: 12,
								color: T.textFaint,
								padding: "6px 2px",
							}}
						>
							No worktrees. Add one from a new session's composer.
						</div>
					) : (
						groups.map((g) => (
							<div key={g.baseDir}>
								<div
									style={{
										fontSize: 10.5,
										fontWeight: 600,
										letterSpacing: 0.6,
										textTransform: "uppercase",
										color: T.textMute,
										marginBottom: 8,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{folderName(g.baseDir)}
								</div>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									{g.items.map((wt) => (
										<WorktreeRow
											key={wt.id}
											worktree={wt}
											onDelete={() => handleDelete(wt.id)}
										/>
									))}
								</div>
							</div>
						))
					)}
				</div>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions" style={{ marginTop: 14 }}>
					<button className="btn" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * One worktree. Same anatomy as the attach modal's `ExistingRow` — color
 * dot, name, branch, session count, trash — minus the click-to-attach, so
 * this is a plain div rather than a role="button". The trash button is the
 * row's only interactive element.
 */
function WorktreeRow({
	worktree,
	onDelete,
}: {
	worktree: Worktree;
	onDelete: () => Promise<void>;
}) {
	const sessionCount = worktree.sessionIds.length;
	const canDelete = sessionCount === 0;
	const c = WORKTREE_COLOR_MAP[worktree.color];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "6px 6px 6px 10px",
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				background: T.surface,
				color: T.text,
				fontSize: 12.5,
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
					color: T.text,
				}}
			>
				{worktree.displayName}
			</span>
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 11,
					color: T.textDim,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					maxWidth: 200,
				}}
			>
				{worktree.branch}
			</span>
			<span
				style={{
					fontSize: 11,
					color: T.textMute,
					flexShrink: 0,
				}}
			>
				{sessionCount} session{sessionCount === 1 ? "" : "s"}
			</span>
			{/* Keep the row width stable whether or not the trash renders —
			    otherwise the session-count column jogs between rows. */}
			{canDelete ? (
				<DeleteWorktreeButton onDelete={onDelete} />
			) : (
				<span aria-hidden style={{ width: 24, height: 24, flexShrink: 0 }} />
			)}
		</div>
	);
}

function folderName(dir: string): string {
	return dir.split("/").filter(Boolean).pop() ?? dir;
}
