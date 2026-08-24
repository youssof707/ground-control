import { useCallback, useEffect, useState } from "react";
import type { SessionMode } from "@shared/claude-sessions/types";
import { T } from "../../../design/tokens";
import { ModeToggle } from "../../../design/Atoms";
import { LabeledInput } from "../../../design/FormControls";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useShortcutsStore } from "../stores/useShortcutsStore";

/**
 * Modal for creating a saved session shortcut (title + folder + prompt +
 * mode). Mirrors RenameGroupModal's shell: same `modal-backdrop` /
 * `modal-card` / `modal-title` / `modal-actions` / `modal-error` classes,
 * Escape-to-close, reset-on-open, busy/error state, and the
 * upsert-from-invoke-response pattern (main's `state:changed` broadcast
 * is skip-self).
 *
 * The folder is chosen via the native picker (window.claude.pickFolder),
 * so it renders as a button showing the picked path — visible text, not
 * a hover label.
 */
export function CreateShortcutModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const upsert = useShortcutsStore((s) => s.upsert);
	const lastUsedCwd = useSettingsStore((s) => s.lastUsedWorkspace);

	const [title, setTitle] = useState("");
	const [cwd, setCwd] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("");
	const [mode, setMode] = useState<SessionMode>("plan");
	const [busy, setBusy] = useState(false);
	const [picking, setPicking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Blank slate on every open (mirrors RenameGroupModal's reset effect).
	useEffect(() => {
		if (!open) return;
		setTitle("");
		setCwd(null);
		setPrompt("");
		setMode("plan");
		setBusy(false);
		setPicking(false);
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

	const pickCwd = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const picked = await window.claude.pickFolder({
				defaultPath: cwd ?? lastUsedCwd,
			});
			if (picked) setCwd(picked);
		} finally {
			setPicking(false);
		}
	}, [picking, cwd, lastUsedCwd]);

	const canSave = !busy && !!cwd && prompt.trim().length > 0;

	const handleSave = useCallback(async () => {
		if (!canSave || !cwd) return;
		setBusy(true);
		setError(null);
		try {
			const created = await window.claude.createShortcut({
				title: title.trim(),
				cwd,
				prompt: prompt.trim(),
				mode,
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
	}, [canSave, cwd, title, prompt, mode, upsert, onClose]);

	if (!open) return null;

	const fieldLabelStyle: React.CSSProperties = {
		fontSize: 11,
		color: T.textDim,
		letterSpacing: 0.2,
	};

	return (
		<div className="modal-backdrop" onClick={onClose} role="presentation">
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="create-shortcut-title"
				style={{ width: "min(440px, calc(100vw - 32px))" }}
			>
				<h2 id="create-shortcut-title" className="modal-title">
					Create shortcut
				</h2>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 12,
						marginBottom: 16,
					}}
				>
					<LabeledInput
						label="Title"
						value={title}
						onChange={setTitle}
						placeholder="Optional — becomes the session name"
						autoFocus
						disabled={busy}
						maxLength={200}
						mono={false}
					/>

					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={fieldLabelStyle}>Folder</span>
						<button
							type="button"
							onClick={() => void pickCwd()}
							disabled={busy || picking}
							style={{
								display: "flex",
								alignItems: "center",
								background: T.surfaceLow,
								color: cwd ? T.text : T.textDim,
								border: `0.5px solid ${T.border}`,
								borderRadius: 6,
								padding: "7px 9px",
								fontSize: 12.5,
								fontFamily: T.mono,
								cursor: "pointer",
								textAlign: "left",
								minWidth: 0,
							}}
						>
							<span
								style={{
									minWidth: 0,
									flex: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									// Keep the folder name (path tail) visible on overflow.
									direction: "rtl",
								}}
							>
								{cwd ?? "Choose folder…"}
							</span>
						</button>
					</div>

					<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={fieldLabelStyle}>Prompt</span>
						<textarea
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder="Message pre-filled when the shortcut runs"
							disabled={busy}
							rows={4}
							style={{
								appearance: "none",
								background: T.surfaceLow,
								color: T.text,
								border: `0.5px solid ${T.border}`,
								borderRadius: 6,
								padding: "7px 9px",
								fontSize: 13,
								fontFamily: T.sans,
								lineHeight: 1.45,
								outline: "none",
								resize: "vertical",
								minHeight: 72,
								transition: "border-color 80ms ease",
							}}
							onFocus={(e) => {
								e.currentTarget.style.borderColor = T.accentBorder;
							}}
							onBlur={(e) => {
								e.currentTarget.style.borderColor = T.border;
							}}
						/>
					</label>

					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={fieldLabelStyle}>Mode</span>
						<div>
							<ModeToggle mode={mode} onChange={setMode} disabled={busy} />
						</div>
					</div>
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
						{busy ? "…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
