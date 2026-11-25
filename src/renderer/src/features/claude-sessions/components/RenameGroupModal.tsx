import { useCallback, useEffect, useState } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { ColorPicker, LabeledInput } from "../../../design/FormControls";
import {
	DEFAULT_WORKTREE_COLOR,
	type WorktreeColor,
} from "@shared/schemas/worktrees";
import { useSessionGroupsStore } from "../stores/useSessionGroupsStore";

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
	const [color, setColor] = useState<WorktreeColor>(DEFAULT_WORKTREE_COLOR);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setName(group?.name ?? "");
		setColor(group?.color ?? DEFAULT_WORKTREE_COLOR);
		setBusy(false);
		setError(null);
	}, [open, group?.name, group?.color]);

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
	const unchanged = group
		? trimmed === group.name && color === group.color
		: false;
	const canSave = !busy && trimmed.length > 0 && !unchanged;

	const handleSave = useCallback(async () => {
		if (!groupId || !group || !canSave) return;
		setBusy(true);
		setError(null);
		try {
			await window.claude.updateGroup({ groupId, name: trimmed, color });
			upsert({ ...group, name: trimmed, color });
			onClose();
		} catch (err) {
			setError((err as Error).message || "Failed to update group");
			setBusy(false);
		}
	}, [groupId, group, canSave, trimmed, color, upsert, onClose]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="rename-group-title"
				style={{ width: "min(380px, calc(100vw - 32px))" }}
			>
				<h2 id="rename-group-title" className="modal-title">
					Edit group
				</h2>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 10,
						marginBottom: 16,
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
						onEnter={handleSave}
					/>
					<ColorPicker
						value={color}
						onChange={setColor}
						disabled={busy}
						label="Color"
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
						{busy ? "…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
