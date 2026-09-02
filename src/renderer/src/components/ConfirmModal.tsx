import { useEffect, type ReactNode } from "react";
import { useBackdropDismiss } from "./useBackdropDismiss";

interface Props {
	open: boolean;
	title: string;
	message: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	error?: string | null;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	/**
	 * Optional third action rendered on the left of the action row (e.g. a
	 * tertiary "Copy path" button). Keyboard shortcuts still map only to
	 * Cancel (Escape) and Confirm (Enter); the extra action is mouse-only.
	 */
	extraAction?: { label: string; onClick: () => void } | null;
	/**
	 * Use when the modal offers two real choices instead of a confirm/cancel
	 * pair (e.g. "Handoff" / "Handoff & delete") — both meaningfully commit
	 * to something, so neither should wear the passive "Cancel" label.
	 *
	 * When set: the plain-text Cancel button is replaced by this labeled
	 * button (same slot, same `.btn` styling, sits immediately left of
	 * Confirm), and dismissal moves to a small × in the card's top-right
	 * corner — still wired to `onCancel`, so Escape/backdrop-click/× all
	 * behave identically to a normal Cancel.
	 */
	secondaryAction?: { label: string; onClick: () => void } | null;
}

export function ConfirmModal({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	error,
	busy = false,
	onConfirm,
	onCancel,
	extraAction = null,
	secondaryAction = null,
}: Props) {
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
			if (e.key === "Enter") onConfirm();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onCancel, onConfirm]);

	const backdropProps = useBackdropDismiss(onCancel);

	if (!open) return null;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
			>
				{secondaryAction ? (
					<button
						type="button"
						onClick={onCancel}
						disabled={busy}
						aria-label="Close"
						style={{
							position: "absolute",
							top: 10,
							right: 10,
							width: 24,
							height: 24,
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: 6,
							border: "none",
							background: "transparent",
							color: "oklch(0.55 0.008 70)",
							cursor: "pointer",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "oklch(0.28 0.008 60)";
							e.currentTarget.style.color = "oklch(0.94 0.005 80)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "transparent";
							e.currentTarget.style.color = "oklch(0.55 0.008 70)";
						}}
					>
						<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
							<path
								d="M2.5 2.5l7 7M9.5 2.5l-7 7"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				) : null}
				<h2 id="modal-title" className="modal-title">
					{title}
				</h2>
				<div className="modal-message">{message}</div>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					{extraAction ? (
						<button
							className="btn"
							onClick={extraAction.onClick}
							disabled={busy}
							style={{ marginRight: "auto" }}
						>
							{extraAction.label}
						</button>
					) : null}
					{secondaryAction ? (
						<button
							className="btn"
							onClick={secondaryAction.onClick}
							disabled={busy}
						>
							{secondaryAction.label}
						</button>
					) : (
						<button className="btn" onClick={onCancel} disabled={busy}>
							{cancelLabel}
						</button>
					)}
					<button
						className={`btn ${destructive ? "btn-destructive" : "btn-primary"}`}
						onClick={onConfirm}
						disabled={busy}
						autoFocus
					>
						{busy ? "…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
