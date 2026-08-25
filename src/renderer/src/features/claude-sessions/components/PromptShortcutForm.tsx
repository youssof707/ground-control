import type { SessionMode } from "@shared/claude-sessions/types";
import type { PromptShortcut } from "@shared/schemas/promptShortcuts";
import { T } from "../../../design/tokens";
import { ModeToggle } from "../../../design/Atoms";
import { LabeledInput } from "../../../design/FormControls";

/**
 * Controlled value for the shared Name / Prompt / Mode fields, shared by
 * CreatePromptShortcutModal and EditPromptShortcutsModal so the two forms
 * can't drift apart.
 *
 * No `cwd` — an in-session shortcut runs against whatever session you're
 * already in. That's the whole difference from ShortcutForm.
 */
export interface PromptShortcutFormValue {
	title: string;
	prompt: string;
	mode: SessionMode;
}

export const EMPTY_PROMPT_SHORTCUT_FORM: PromptShortcutFormValue = {
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
 * Name / Prompt / Mode fields for an in-session prompt shortcut. Owns only
 * the controlled fields; busy/error/save/Escape lifecycle stays with each
 * caller.
 */
export function PromptShortcutFormFields({
	value,
	onChange,
	disabled,
	autoFocus,
}: {
	value: PromptShortcutFormValue;
	onChange: (next: PromptShortcutFormValue) => void;
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
					placeholder="Text appended to the composer when this runs"
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
 * Display label for a prompt shortcut. The title is required at every write
 * path, but reads stay permissive (see promptShortcuts.ts) so a legacy or
 * hand-edited blank title still gets something clickable in the menu.
 */
export function promptShortcutLabel(sc: PromptShortcut): string {
	return sc.title.trim() || promptPreview(sc.prompt) || "Untitled";
}
