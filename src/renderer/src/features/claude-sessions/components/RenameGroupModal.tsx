import { useCallback, useEffect, useState } from "react";
import { LabeledInput } from "../../../design/FormControls";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";

/**
 * Modal for renaming a sidebar session group. Mirrors AddToGroupModal's
 * shell (same `modal-backdrop` / `modal-card` / `modal-title` /
 * `modal-actions` / `modal-error` CSS classes, same Escape-to-close /
 * Enter-to-submit / reset-on-open behavior), just simpler — a single
 * name field, no color picker, no member list.
 *
 * Open ⇔ `groupId != null`, matching the pendingGroupSessionId /
 * pendingDeleteId pattern SessionsList uses for its other modals.
 * The current name is seeded from the groups store on open so the
 * input starts populated (edit-in-place feel rather than clear-first).
 */
export function RenameGroupModal({
	groupId,
	onClose,
}: {
	groupId: string | null;
	onClose: () => void;
}) {
	const open = groupId != null;
	const groups = useSessionGroupsStore((s) => s.groups);
	const upsert = useSessionGroupsStore((s) => s.upsert);
	const group = groupId ? groups[groupId] : undefined;

	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Seed the input with the group's current name on every open — the
	// modal is edit-in-place, not blank. Also clears busy/error carried
	// over from a previous open (mirrors AddToGroupModal).
	useEffect(() => {
		if (!open) return;
		setName(group?.name ?? "");
		setBusy(false);
		setError(null);
	}, [open, group?.name]);

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

	const trimmed = name.trim();
	const unchanged = group ? trimmed === group.name : false;
	const canSave = !busy && trimmed.length > 0 && !unchanged;

	const handleSave = useCallback(async () => {
		if (!groupId || !group || !canSave) return;
		setBusy(true);
		setError(null);
		try {
			await window.claude.renameGroup(groupId, trimmed);
			// Hydrate the local cache immediately: main's `state:changed`
			// is skip-self, so without this upsert the originating window
			// would keep rendering the stale name until the next refetch.
			upsert({ ...group, name: trimmed });
			onClose();
		} catch (err) {
			setError((err as Error).message || "Failed to rename group");
			setBusy(false);
		}
	}, [groupId, group, canSave, trimmed, upsert, onClose]);

	if (!open) return null;

	return (
		<div className="modal-backdrop" onClick={onClose} role="presentation">
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="rename-group-title"
				style={{ width: "min(380px, calc(100vw - 32px))" }}
			>
				<h2 id="rename-group-title" className="modal-title">
					Rename group
				</h2>

				<div style={{ marginBottom: 16 }}>
					<LabeledInput
						label="Name"
						value={name}
						onChange={setName}
						autoFocus
						disabled={busy}
						maxLength={60}
						mono={false}
						onEnter={handleSave}
					/>
				</div>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button
						className="btn btn-primary"
						disabled={!canSave}
						onClick={() => void handleSave()}
					>
						{busy ? "…" : "Rename"}
					</button>
				</div>
			</div>
		</div>
	);
}
