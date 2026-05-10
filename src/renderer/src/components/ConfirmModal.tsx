import { useEffect, type ReactNode } from "react";

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

	if (!open) return null;

	return (
		<div
			className="modal-backdrop"
			onClick={onCancel}
			role="presentation"
		>
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
			>
				<h2 id="modal-title" className="modal-title">
					{title}
				</h2>
				<div className="modal-message">{message}</div>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					<button className="btn" onClick={onCancel} disabled={busy}>
						{cancelLabel}
					</button>
					<button
						className={`btn ${destructive ? "btn-destructive" : ""}`}
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
