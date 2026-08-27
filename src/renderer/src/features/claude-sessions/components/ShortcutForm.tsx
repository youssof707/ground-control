import type { SessionMode } from "@shared/claude-sessions/types";
import type { Shortcut } from "@shared/schemas/shortcuts";
import { T } from "../../../design/tokens";
import { ModeToggle } from "../../../design/Atoms";
import { LabeledInput } from "../../../design/FormControls";

/**
 * Controlled value for the shared Name / Prompt / Mode fields, shared by
 * CreateShortcutModal and EditShortcutsModal so the two forms can't drift
 * apart.
 */
export interface ShortcutFormValue {
	title: string;
	prompt: string;
	mode: SessionMode;
}

export const EMPTY_SHORTCUT_FORM: ShortcutFormValue = {
	title: "",
	prompt: "",
	mode: "plan",
};

const fieldLabelStyle: React.CSSProperties = {
	fontSize: 11,
	color: T.textDim,
	letterSpacing: 0.2,
};

/**
 * Name / Prompt / Mode fields for a shortcut. Owns only the controlled
 * fields; busy/error/save/Escape lifecycle stays with each caller.
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
				label="Name"
				value={value.title}
				onChange={(title) => onChange({ ...value, title })}
				placeholder="Name for this shortcut"
				autoFocus={autoFocus}
				disabled={disabled}
				maxLength={200}
				mono={false}
			/>

			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Prompt</span>
				<textarea
					value={value.prompt}
					onChange={(e) => onChange({ ...value, prompt: e.target.value })}
					placeholder="Text added to the composer when this runs"
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

/** First line of a prompt, truncated — the label fallback and row preview. */
export function promptPreview(prompt: string, max = 48): string {
	const line = prompt.split("\n").find((l) => l.trim()) ?? "";
	const trimmed = line.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Display label for a shortcut. The title is required at every write path,
 * but reads stay permissive (see shortcuts.ts) so a legacy or hand-edited
 * blank title still gets something clickable in the menu.
 */
export function shortcutLabel(sc: Shortcut): string {
	return sc.title.trim() || promptPreview(sc.prompt) || "Untitled";
}
