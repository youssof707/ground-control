import { useCallback, useState } from "react";
import type { SessionMode } from "@shared/claude-sessions/types";
import type { Shortcut } from "@shared/schemas/shortcuts";
import { T } from "../../../design/tokens";
import { ModeToggle } from "../../../design/Atoms";
import { LabeledInput } from "../../../design/FormControls";
import { useSettingsStore } from "../stores/useSettingsStore";

/**
 * Controlled value for the shared Title / Folder / Prompt / Mode fields,
 * shared by CreateShortcutModal and EditShortcutsModal so the two forms
 * can't drift apart. `cwd` is `null` until a folder is picked.
 */
export interface ShortcutFormValue {
	title: string;
	cwd: string | null;
	prompt: string;
	mode: SessionMode;
}

export const EMPTY_SHORTCUT_FORM: ShortcutFormValue = {
	title: "",
	cwd: null,
	prompt: "",
	mode: "plan",
};

const fieldLabelStyle: React.CSSProperties = {
	fontSize: 11,
	color: T.textDim,
	letterSpacing: 0.2,
};

/**
 * Title / Folder / Prompt / Mode fields for a shortcut. Extracted from
 * CreateShortcutModal so create and edit can't diverge — this component
 * owns only the controlled fields (including the native folder picker);
 * busy/error/save/Escape lifecycle stays with each caller.
 */
export function ShortcutFormFields({
	value,
	onChange,
	disabled,
	autoFocus,
}: {
	value: ShortcutFormValue;
	onChange: (next: ShortcutFormValue) => void;
	disabled?: boolean;
	autoFocus?: boolean;
}) {
	const lastUsedCwd = useSettingsStore((s) => s.lastUsedWorkspace);
	const [picking, setPicking] = useState(false);

	const pickCwd = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const picked = await window.claude.pickFolder({
				defaultPath: value.cwd ?? lastUsedCwd,
			});
			if (picked) onChange({ ...value, cwd: picked });
		} finally {
			setPicking(false);
		}
	}, [picking, value, lastUsedCwd, onChange]);

	return (
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
				value={value.title}
				onChange={(title) => onChange({ ...value, title })}
				placeholder="Optional — becomes the session name"
				autoFocus={autoFocus}
				disabled={disabled}
				maxLength={200}
				mono={false}
			/>

			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Folder</span>
				<button
					type="button"
					onClick={() => void pickCwd()}
					disabled={disabled || picking}
					style={{
						display: "flex",
						alignItems: "center",
						background: T.surfaceLow,
						color: value.cwd ? T.text : T.textDim,
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
						}}
					>
						{value.cwd ? folderName(value.cwd) : "Choose folder…"}
					</span>
				</button>
			</div>

			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Prompt</span>
				<textarea
					value={value.prompt}
					onChange={(e) => onChange({ ...value, prompt: e.target.value })}
					placeholder="Message pre-filled when the shortcut runs"
					disabled={disabled}
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
					<ModeToggle
						mode={value.mode}
						onChange={(mode) => onChange({ ...value, mode })}
						disabled={disabled}
					/>
				</div>
			</div>
		</div>
	);
}

/**
 * Last path segment of a cwd — the folder name a user actually
 * recognizes. Shown everywhere a shortcut's folder appears (create/edit
 * form, manage list) instead of the full absolute path.
 */
export function folderName(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() || cwd;
}

/** Display label for a shortcut: its title, or the cwd's folder name. */
export function shortcutLabel(sc: Shortcut): string {
	return sc.title.trim() || folderName(sc.cwd);
}
