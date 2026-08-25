import { useCallback, useEffect, useState } from "react";
import { usePromptShortcutsStore } from "../stores/usePromptShortcutsStore";
import {
	EMPTY_PROMPT_SHORTCUT_FORM,
	PromptShortcutFormFields,
	type PromptShortcutFormValue,
} from "./PromptShortcutForm";

/**
 * Modal for creating an in-session prompt shortcut (name + prompt + mode).
 * Same shell as CreateShortcutModal: `modal-backdrop` / `modal-card` /
 * `modal-title` / `modal-actions` / `modal-error` classes, Escape-to-close,
 * reset-on-open, busy/error state, and the upsert-from-invoke-response
 * pattern (main's `state:changed` broadcast is skip-self).
 */
export function CreatePromptShortcutModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const upsert = usePromptShortcutsStore((s) => s.upsert);

	const [form, setForm] = useState<PromptShortcutFormValue>(
		EMPTY_PROMPT_SHORTCUT_FORM,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Blank slate on every open.
	useEffect(() => {
		if (!open) return;
		setForm(EMPTY_PROMPT_SHORTCUT_FORM);
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

	// Name is required here — unlike a session shortcut there's no folder to
	// fall back on for the menu label.
	const canSave =
		!busy && form.title.trim().length > 0 && form.prompt.trim().length > 0;

	const handleSave = useCallback(async () => {
		if (!canSave) return;
		setBusy(true);
		setError(null);
		try {
			const created = await window.claude.createPromptShortcut({
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

	if (!open) return null;

	return (
		<div className="modal-backdrop" onClick={onClose} role="presentation">
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="create-prompt-shortcut-title"
				style={{ width: "min(440px, calc(100vw - 32px))" }}
			>
				<h2 id="create-prompt-shortcut-title" className="modal-title">
					Create prompt shortcut
				</h2>

				<PromptShortcutFormFields
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
