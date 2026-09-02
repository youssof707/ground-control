import { useCallback, useEffect, useState } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import {
	EMPTY_SHORTCUT_FORM,
	ShortcutFormFields,
	type ShortcutFormValue,
} from "./ShortcutForm";

/**
 * Modal for creating a saved shortcut (name + prompt + mode). Mirrors
 * RenameGroupModal's shell: same `modal-backdrop` / `modal-card` /
 * `modal-title` / `modal-actions` / `modal-error` classes, Escape-to-close,
 * reset-on-open, busy/error state, and the upsert-from-invoke-response
 * pattern (main's `state:changed` broadcast is skip-self).
 *
 * The Name/Prompt/Mode fields live in ShortcutFormFields, shared with
 * EditShortcutsModal's edit view so the two forms can't diverge.
 */
export function CreateShortcutModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const upsert = useShortcutsStore((s) => s.upsert);

	const [form, setForm] = useState<ShortcutFormValue>(EMPTY_SHORTCUT_FORM);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Blank slate on every open (mirrors RenameGroupModal's reset effect).
	useEffect(() => {
		if (!open) return;
		setForm(EMPTY_SHORTCUT_FORM);
		setBusy(false);
		setError(null);
	}, [open]);

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

	const canSave =
		!busy && form.title.trim().length > 0 && form.prompt.trim().length > 0;

	const handleSave = useCallback(async () => {
		if (!canSave) return;
		setBusy(true);
		setError(null);
		try {
			const created = await window.claude.createShortcut({
				title: form.title.trim(),
				prompt: form.prompt.trim(),
				mode: form.mode,
			});
			// Hydrate the local cache immediately: main's `state:changed`
			// is skip-self, so without this upsert the originating window
			// wouldn't see the new shortcut until the next refetch.
			upsert(created);
			onClose();
		} catch (err) {
			setError((err as Error).message || "Failed to create shortcut");
			setBusy(false);
		}
	}, [canSave, form, upsert, onClose]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="create-shortcut-title"
				style={{ width: "min(440px, calc(100vw - 32px))" }}
			>
				<h2 id="create-shortcut-title" className="modal-title">
					Create shortcut
				</h2>

				<ShortcutFormFields
					value={form}
					onChange={setForm}
					disabled={busy}
					autoFocus
				/>

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
						{busy ? "…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
