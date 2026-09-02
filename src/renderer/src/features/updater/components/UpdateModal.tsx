import { useEffect } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { useUpdateStore } from "../stores/useUpdateStore";

/**
 * The single-modal, multi-phase update UI. Renders differently based on
 * `store.status`:
 *   - "available"    → show version diff + release notes + Install / Later buttons
 *   - "up-to-date"   → simple "You're on the latest version" confirmation
 *   - "downloading"  → progress bar (percent from `updater:progress`)
 *   - "mounting"     → indeterminate spinner label
 *   - "installing"   → "Restarting…" label (app is about to quit)
 *   - "error"        → error message with Close
 *
 * Reuses the existing `.modal-backdrop` / `.modal-card` styles from
 * index.css so it visually matches ConfirmModal.
 */
export function UpdateModal() {
	const status = useUpdateStore((s) => s.status);
	const modalOpen = useUpdateStore((s) => s.modalOpen);
	const info = useUpdateStore((s) => s.info);
	const progressPct = useUpdateStore((s) => s.progressPct);
	const error = useUpdateStore((s) => s.error);
	const closeModal = useUpdateStore((s) => s.closeModal);
	const reset = useUpdateStore((s) => s.reset);

	// Once the install kicks off (downloading/mounting/installing) we should
	// NOT allow closing — the app is committed to relaunching and pulling the
	// modal out would leave a confusing half-state.
	const installInProgress =
		status === "downloading" ||
		status === "mounting" ||
		status === "installing";

	// Esc closes only when it's safe. Matches ConfirmModal's keyboard pattern.
	useEffect(() => {
		if (!modalOpen) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !installInProgress) closeModal();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [modalOpen, installInProgress, closeModal]);

	// `undefined` while installing keeps the backdrop inert, same as before.
	const backdropProps = useBackdropDismiss(
		installInProgress ? undefined : closeModal,
	);

	if (!modalOpen) return null;

	async function onInstall() {
		if (!info?.downloadUrl) return;
		try {
			// Fire-and-forget. Main will broadcast status/progress events,
			// which the hook forwards into the store. When the install phase
			// completes, main calls app.quit() and this window goes away.
			await window.claude.installUpdate(info.downloadUrl);
		} catch (err) {
			useUpdateStore
				.getState()
				.setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="update-modal-title"
				style={{ width: "min(520px, calc(100vw - 32px))" }}
			>
				{renderBody({
					status,
					info,
					progressPct,
					error,
					onInstall,
					onClose: () => {
						closeModal();
						// After a terminal state (error / up-to-date), reset
						// on close so a subsequent menu click starts clean.
						if (status === "error" || status === "up-to-date") reset();
					},
				})}
			</div>
		</div>
	);
}

interface BodyProps {
	status: ReturnType<typeof useUpdateStore.getState>["status"];
	info: ReturnType<typeof useUpdateStore.getState>["info"];
	progressPct: number | null;
	error: string | null;
	onInstall: () => void;
	onClose: () => void;
}

function renderBody({
	status,
	info,
	progressPct,
	error,
	onInstall,
	onClose,
}: BodyProps) {
	if (status === "up-to-date" && info) {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					You're up to date
				</h2>
				<div className="modal-message">
					Ground Control v{info.currentVersion} is the latest version.
				</div>
				<div className="modal-actions">
					<button className="btn btn-primary" onClick={onClose} autoFocus>
						OK
					</button>
				</div>
			</>
		);
	}

	if (status === "error") {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					Update failed
				</h2>
				<div className="modal-error">{error ?? "Unknown error"}</div>
				<div className="modal-actions">
					<button className="btn btn-primary" onClick={onClose} autoFocus>
						Close
					</button>
				</div>
			</>
		);
	}

	if (status === "downloading" && info) {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					Downloading v{info.latestVersion}
				</h2>
				<div className="modal-message">
					{progressPct !== null
						? `${progressPct}% — please don't quit the app.`
						: "Starting download…"}
				</div>
				<ProgressBar pct={progressPct ?? 0} />
			</>
		);
	}

	if (status === "mounting" && info) {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					Preparing v{info.latestVersion}
				</h2>
				<div className="modal-message">Mounting the update…</div>
				<ProgressBar pct={100} indeterminate />
			</>
		);
	}

	if (status === "installing" && info) {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					Installing v{info.latestVersion}
				</h2>
				<div className="modal-message">
					Ground Control is about to restart to complete the update.
				</div>
				<ProgressBar pct={100} indeterminate />
			</>
		);
	}

	// Default: "available"
	if (info) {
		return (
			<>
				<h2 id="update-modal-title" className="modal-title">
					Update available — v{info.latestVersion}
				</h2>
				<div className="modal-message">
					You're running v{info.currentVersion}. Install v{info.latestVersion}?
				</div>
				<div className="modal-actions">
					<button className="btn" onClick={onClose}>
						Later
					</button>
					<button
						className="btn btn-primary"
						onClick={onInstall}
						autoFocus
					>
						Install and restart
					</button>
				</div>
			</>
		);
	}

	// Falls through if opened before we have info (shouldn't happen).
	return null;
}

/**
 * Minimal inline progress bar. Indeterminate mode paints a pulsing full bar
 * for the mounting / installing phases where we don't have byte-level
 * progress.
 */
function ProgressBar({
	pct,
	indeterminate = false,
}: {
	pct: number;
	indeterminate?: boolean;
}) {
	return (
		<div
			style={{
				height: 6,
				background: "oklch(0.22 0.006 60)",
				borderRadius: 3,
				overflow: "hidden",
				marginTop: 4,
			}}
		>
			<div
				style={{
					width: `${Math.max(0, Math.min(100, pct))}%`,
					height: "100%",
					background: "oklch(0.65 0.15 55)",
					transition: indeterminate ? "none" : "width 0.15s linear",
					opacity: indeterminate ? 0.6 : 1,
					animation: indeterminate ? "modal-fade-in 1s ease-in-out infinite alternate" : "none",
				}}
			/>
		</div>
	);
}
