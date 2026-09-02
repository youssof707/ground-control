import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import type { Shortcut } from "@shared/schemas/shortcuts";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import {
	EMPTY_SHORTCUT_FORM,
	promptPreview,
	ShortcutFormFields,
	shortcutLabel,
	type ShortcutFormValue,
} from "./ShortcutForm";

type View = { kind: "list" } | { kind: "edit"; id: string };

/**
 * Manage-shortcuts modal: a list of saved shortcuts, each deletable
 * inline or clickable into an edit form. One `.modal-card`, list ↔ edit
 * view swap in place (no stacked backdrops) — Escape steps back to the
 * list from edit, and closes the modal from the list.
 */
export function EditShortcutsModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const shortcutsById = useShortcutsStore((s) => s.shortcuts);
	const upsert = useShortcutsStore((s) => s.upsert);
	const remove = useShortcutsStore((s) => s.remove);

	const [view, setView] = useState<View>({ kind: "list" });
	const [form, setForm] = useState<ShortcutFormValue>(EMPTY_SHORTCUT_FORM);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset to the list on every open.
	useEffect(() => {
		if (!open) return;
		setView({ kind: "list" });
		setBusy(false);
		setError(null);
	}, [open]);

	// Seed the form when entering edit — keyed on the id only, not the
	// reactive shortcuts map, so an unrelated upsert (another window's
	// broadcast-driven refetch) doesn't clobber in-progress typing.
	const editingId = view.kind === "edit" ? view.id : null;
	useEffect(() => {
		if (!editingId) return;
		const current = useShortcutsStore.getState().shortcuts[editingId];
		setForm(
			current
				? {
					title: current.title,
					prompt: current.prompt,
					mode: current.mode,
				}
				: EMPTY_SHORTCUT_FORM,
		);
		setBusy(false);
		setError(null);
	}, [editingId]);

	// Escape steps back from edit, or closes from the list.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				if (view.kind === "edit") setView({ kind: "list" });
				else onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, view.kind, onClose]);

	const shortcuts = Object.values(shortcutsById).sort((a, b) =>
		shortcutLabel(a).localeCompare(shortcutLabel(b), undefined, {
			sensitivity: "base",
		}),
	);

	const original = view.kind === "edit" ? shortcutsById[view.id] : undefined;
	const unchanged =
		!!original &&
		form.title.trim() === original.title &&
		form.prompt.trim() === original.prompt &&
		form.mode === original.mode;
	const canSave =
		!busy &&
		form.title.trim().length > 0 &&
		form.prompt.trim().length > 0 &&
		!unchanged;

	const handleSave = useCallback(async () => {
		if (view.kind !== "edit" || !canSave) return;
		setBusy(true);
		setError(null);
		try {
			const updated = await window.claude.updateShortcut({
				id: view.id,
				title: form.title.trim(),
				prompt: form.prompt.trim(),
				mode: form.mode,
			});
			// Hydrate the local cache immediately: main's `state:changed`
			// is skip-self, so without this upsert the originating window
			// wouldn't see the edit until the next refetch.
			upsert(updated);
			setView({ kind: "list" });
		} catch (err) {
			setError((err as Error).message || "Failed to update shortcut");
			setBusy(false);
		}
	}, [view, canSave, form, upsert]);

	const handleDelete = useCallback(
		async (id: string) => {
			setError(null);
			try {
				await window.claude.deleteShortcut(id);
				remove(id);
			} catch (err) {
				setError((err as Error).message || "Failed to delete shortcut");
				throw err;
			}
		},
		[remove],
	);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="edit-shortcuts-title"
				style={{ width: "min(480px, calc(100vw - 32px))" }}
			>
				{view.kind === "list" ? (
					<>
						<h2 id="edit-shortcuts-title" className="modal-title">
							Edit shortcuts
						</h2>

						<Section title="Saved shortcuts">
							{shortcuts.length > 0 ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 6,
										maxHeight: "min(50vh, 360px)",
										overflowY: "auto",
									}}
								>
									{shortcuts.map((sc) => (
										<ShortcutRow
											key={sc.id}
											shortcut={sc}
											onClick={() => setView({ kind: "edit", id: sc.id })}
											onDelete={() => handleDelete(sc.id)}
										/>
									))}
								</div>
							) : (
								<div style={{ fontSize: 12.5, color: T.textDim }}>
									No shortcuts yet.
								</div>
							)}
						</Section>

						{error ? <div className="modal-error">{error}</div> : null}

						<div className="modal-actions">
							<button className="btn" onClick={onClose}>
								Done
							</button>
						</div>
					</>
				) : (
					<>
						<h2 id="edit-shortcuts-title" className="modal-title">
							Edit shortcut
						</h2>

						<ShortcutFormFields
							value={form}
							onChange={setForm}
							disabled={busy}
							autoFocus
						/>

						{error ? <div className="modal-error">{error}</div> : null}

						<div className="modal-actions">
							<button
								className="btn"
								onClick={() => setView({ kind: "list" })}
								disabled={busy}
							>
								Back
							</button>
							<button
								className="btn btn-primary"
								disabled={!canSave}
								onClick={() => void handleSave()}
							>
								{busy ? "…" : "Save"}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// Intentionally duplicated in AttachWorktreeModal.tsx / AddToGroupModal.tsx —
// 8 trivial lines, not worth a shared import.
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

const MODE_LABEL: Record<Shortcut["mode"], string> = {
	plan: "Plan",
	acceptEdits: "Accept edits",
};

function ShortcutRow({
	shortcut,
	onClick,
	onDelete,
}: {
	shortcut: Shortcut;
	onClick: () => void;
	onDelete: () => Promise<void>;
}) {
	const [hover, setHover] = useState(false);
	// Outer is a role="button" div rather than a real <button> so we can
	// nest an actual <button> (the trash) inside it — nested <button>s are
	// invalid HTML. Keyboard support (Enter/Space) is preserved manually.
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				textAlign: "left",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "6px 6px 6px 10px",
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: hover ? T.surfaceHi : T.surface,
				color: T.text,
				cursor: "pointer",
				fontSize: 12.5,
				transition: "background 80ms ease, border-color 80ms ease",
				outline: "none",
			}}
		>
			<span
				style={{
					fontWeight: 600,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
					flexShrink: 0,
					maxWidth: 160,
					color: T.text,
				}}
			>
				{shortcutLabel(shortcut)}
			</span>
			<span
				style={{
					fontSize: 11,
					color: T.textDim,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
					flex: 1,
				}}
			>
				{promptPreview(shortcut.prompt, 60)}
			</span>
			<span
				style={{
					fontSize: 11,
					color: T.textMute,
					flexShrink: 0,
				}}
			>
				{MODE_LABEL[shortcut.mode]}
			</span>
			<DeleteShortcutButton onDelete={onDelete} />
		</div>
	);
}

const CONFIRM_REVERT_MS = 3000;

/**
 * Two-step delete confirmation matching DeleteWorktreeButton /
 * NoteCard's pattern: trash icon by default, click reveals a
 * danger-token "Confirm delete?" pill, second click within
 * CONFIRM_REVERT_MS fires. Clicks stop bubbling so hitting the trash
 * doesn't also trigger the row's edit handler.
 */
function DeleteShortcutButton({
	onDelete,
}: {
	onDelete: () => Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Guard against setState after the row unmounts — the success path removes
	// this shortcut from the store, which unmounts us before the awaited IPC
	// settles. Only the failure path stays mounted long enough to need the
	// `setDeleting(false)` reset.
	const mountedRef = useRef(true);
	useEffect(() => {
		return () => {
			mountedRef.current = false;
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);
	const handleClick = async (e: ReactMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		if (deleting) return;
		if (!confirming) {
			setConfirming(true);
			timerRef.current = setTimeout(() => {
				setConfirming(false);
				timerRef.current = null;
			}, CONFIRM_REVERT_MS);
			return;
		}
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setConfirming(false);
		setDeleting(true);
		try {
			await onDelete();
		} catch {
			// Error already surfaced via the modal-level setError in
			// handleDelete; just fall through to reset local state.
		} finally {
			if (mountedRef.current) setDeleting(false);
		}
	};
	if (deleting) {
		// Same pill dimensions/border as the "Confirm delete?" branch so the
		// row doesn't reflow when we swap in the spinner. Spinner CSS is the
		// shared `.asyncy-btn-spinner` from index.css (14×14, fits the pill).
		return (
			<button
				type="button"
				disabled
				aria-busy
				aria-label="Deleting shortcut"
				style={{
					padding: "4px 10px",
					borderRadius: 6,
					border: `0.5px solid ${T.dangerBorder}`,
					background: T.dangerSoft,
					color: T.danger,
					fontSize: 11.5,
					fontWeight: 500,
					fontFamily: T.sans,
					lineHeight: 1.2,
					cursor: "default",
					flexShrink: 0,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<span className="asyncy-btn-spinner" aria-hidden />
			</button>
		);
	}
	if (confirming) {
		return (
			<button
				type="button"
				onClick={handleClick}
				aria-label="Confirm delete shortcut"
				style={{
					padding: "4px 10px",
					borderRadius: 6,
					border: `0.5px solid ${T.dangerBorder}`,
					background: T.dangerSoft,
					color: T.danger,
					fontSize: 11.5,
					fontWeight: 500,
					fontFamily: T.sans,
					lineHeight: 1.2,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				Confirm delete?
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={handleClick}
			aria-label="Delete shortcut"
			style={{
				width: 24,
				height: 24,
				padding: 0,
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.textMute,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
				flexShrink: 0,
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<path
					d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M6 6v4M8 6v4"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}
