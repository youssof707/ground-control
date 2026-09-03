import { useEffect, useState } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { Kbd } from "../../../design/Atoms";
import { T } from "../../../design/tokens";
import {
	formatModelName,
	parseModelIdentity,
} from "@shared/claude-sessions/sessionModel";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ModelPickerModal } from "./ModelPickerModal";

/**
 * Kept in sync with CLAUDE.md's "Keyboard shortcuts" section by hand; when
 * that list changes, update both.
 */
const SHORTCUTS: { keys: string[]; label: string }[] = [
	{ keys: ["⌘", "N"], label: "New session" },
	{ keys: ["⌘", "S"], label: "Open a side quest" },
	{ keys: ["⌘", "K"], label: "Open the shortcut menu" },
	{ keys: ["⌘", "R"], label: "Quote selection into the composer" },
	{ keys: ["⌘", "."], label: "Stop the running session" },
	{ keys: ["⌘", "P"], label: "Toggle plan mode (in the composer)" },
	{ keys: ["⌘", "D"], label: "Start / stop voice dictation" },
	{ keys: ["⌘", "⇧", "M"], label: "Open the model picker" },
	{ keys: ["⌘", "⇧", "Z"], label: "Restore the most recently deleted session" },
];

/**
 * App settings modal. Opened from the sidebar's view-options dropdown.
 * "Default model" plus a "Keyboard shortcuts" reference list. Follows the
 * same `.modal-backdrop` / `.modal-card` shell as `ConfirmModal` /
 * `EditShortcutsModal`, no dedicated `Modal` wrapper exists in this repo.
 */
export function SettingsModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const defaultModel = useSettingsStore((s) => s.defaultModel);
	const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			// The model picker stacks on top of this modal and runs its own
			// Escape listener. Without this guard, one Escape press would
			// close both — dumping the user out of Settings when they only
			// meant to back out of the model list.
			if (modelPickerOpen) return;
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose, modelPickerOpen]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	// `formatModelName` strips a trailing "[1m]" the same way it strips any
	// other bracket decoration, so a 1M-context pick would otherwise render
	// identically to its non-1M sibling — call that out explicitly rather
	// than caching a display label (which would go stale, see the field's
	// doc comment in app_settings.ts).
	const modelLabel = defaultModel
		? formatModelName(defaultModel) +
			(parseModelIdentity(defaultModel)?.oneM ? " · 1M context" : "")
		: "Default";

	return (
		<>
			<div className="modal-backdrop" {...backdropProps}>
				<div
					className="modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="settings-title"
					style={{ width: "min(420px, calc(100vw - 32px))" }}
				>
					<h2 id="settings-title" className="modal-title">
						Settings
					</h2>

					<Section title="Default model">
						<ModelPickerButton
							label={modelLabel}
							onClick={() => setModelPickerOpen(true)}
						/>
					</Section>

					<Section title="Keyboard shortcuts">
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							{SHORTCUTS.map((sc) => (
								<div
									key={sc.label}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 10,
										padding: "4px 2px",
									}}
								>
									<div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
										{sc.keys.map((k, i) => (
											<Kbd key={i}>{k}</Kbd>
										))}
									</div>
									<span style={{ fontSize: 12.5, color: T.text }}>
										{sc.label}
									</span>
								</div>
							))}
						</div>
					</Section>

					<div className="modal-actions">
						<button className="btn" onClick={onClose}>
							Done
						</button>
					</div>
				</div>
			</div>

			<ModelPickerModal
				open={modelPickerOpen}
				effectiveModel={defaultModel}
				subtitle="Applies to new sessions. Existing sessions keep their own model."
				focusComposerAfterSelect={false}
				onSelect={(value) => setDefaultModel(value)}
				onClose={() => setModelPickerOpen(false)}
			/>
		</>
	);
}

// Mirrors DraftModelBar's clickable label (DraftSessionChat.tsx): mono,
// dim by default, brightens + underlines on hover. Not a tooltip — no
// `title=`, the affordance is the visible underline-on-hover itself.
function ModelPickerButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				alignSelf: "flex-start",
				padding: 0,
				border: "none",
				background: "none",
				fontFamily: T.mono,
				fontSize: 12,
				color: hover ? T.text : T.textDim,
				textDecoration: hover ? "underline" : "none",
				textUnderlineOffset: 3,
				cursor: "pointer",
			}}
		>
			{label}
		</button>
	);
}

// Intentionally duplicated in AddToGroupModal.tsx / EditShortcutsModal.tsx /
// AttachWorktreeModal.tsx — 8 trivial lines, not worth a shared import.
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
