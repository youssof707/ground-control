import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../../../design/tokens";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { useUndoStore } from "../stores/useUndoStore";
import { restoreEntry } from "../lib/undoActions";

/**
 * The durable half of undo, opened from "Recently deleted (n)" in the
 * sidebar's view-options menu.
 *
 * The toast is gone in eight seconds and Shift+Cmd+Z is invisible, so without
 * this nothing on screen would ever suggest a deleted session is still
 * recoverable. This is the surface for "I noticed twenty minutes later."
 *
 * The footer line is not decoration — it's what makes the list honest. The
 * buffer is in-memory only, so a list that looked durable but silently emptied
 * on relaunch would be a worse promise than having no list at all.
 *
 * Restores route through the same `restoreEntry` the toast and hotkey use, so
 * there's exactly one restore path in the app.
 */
export function RecentlyDeletedModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const entries = useUndoStore((s) => s.entries);
	const backdropProps = useBackdropDismiss(onClose);

	// Same window-level Escape handling as ConfirmModal / SettingsModal.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	// Restoring the last entry empties the list — close rather than leave an
	// empty card sitting there. Mirrors how BackgroundTasksIndicator collapses
	// when its last error is dismissed.
	useEffect(() => {
		if (open && entries.length === 0) onClose();
	}, [open, entries.length, onClose]);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="recently-deleted-title"
			>
				<h2 id="recently-deleted-title" className="modal-title">
					Recently deleted
				</h2>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 6,
						maxHeight: 320,
						overflowY: "auto",
						margin: "12px 0",
					}}
				>
					{entries.map((entry) => (
						<div
							key={entry.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "8px 10px",
								background: T.surfaceLow,
								border: `0.5px solid ${T.borderSoft}`,
								borderRadius: 7,
							}}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 13,
										color: T.text,
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{entry.title}
								</div>
								{/* Second line carries the one consequence a
								    restore can't reverse. Silent otherwise —
								    there's nothing useful to say about a clean
								    delete that the title doesn't already say. */}
								{entry.worktreeDeleted ? (
									<div
										style={{
											fontSize: 11,
											color: T.textMute,
											marginTop: 2,
										}}
									>
										Its worktree was deleted and won't come back.
									</div>
								) : null}
							</div>
							<button
								type="button"
								className="btn"
								onClick={() => restoreEntry(entry, navigate)}
								style={{ flexShrink: 0 }}
							>
								Restore
							</button>
						</div>
					))}
				</div>
				<div
					style={{
						fontSize: 11,
						color: T.textMute,
						borderTop: `0.5px solid ${T.borderSoft}`,
						paddingTop: 10,
					}}
				>
					Cleared when you quit Ground Control.
				</div>
				<div className="modal-actions" style={{ marginTop: 14 }}>
					<button className="btn" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
