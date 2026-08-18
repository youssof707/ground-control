import { T } from "./tokens";
import { WORKTREE_COLOR_MAP } from "./WorktreeChip";
import type { WorktreeColor } from "@shared/schemas/worktrees";

/**
 * Shared modal form controls. Originally inline in `AttachWorktreeModal`
 * ("kept inline — no reuse case yet"); extracted once `AddToGroupModal`
 * became the second consumer, same trajectory as `WORKTREE_COLOR_MAP`
 * moving into `WorktreeChip.tsx`.
 */

export function LabeledInput({
	label,
	value,
	onChange,
	placeholder,
	autoFocus,
	disabled,
	maxLength,
	hint,
	hintError,
	onEnter,
	mono = true,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	autoFocus?: boolean;
	disabled?: boolean;
	maxLength?: number;
	hint?: string;
	hintError?: boolean;
	onEnter?: () => void;
	/** Monospace input text (branch names, paths). Group/display names
	 * read better in the sans stack — pass `mono={false}`. Defaults to
	 * true to preserve the original worktree-modal behavior. */
	mono?: boolean;
}) {
	return (
		<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<span
				style={{
					fontSize: 11,
					color: T.textDim,
					letterSpacing: 0.2,
				}}
			>
				{label}
			</span>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				disabled={disabled}
				autoFocus={autoFocus}
				maxLength={maxLength}
				onKeyDown={(e) => {
					if (e.key === "Enter" && onEnter) {
						e.preventDefault();
						onEnter();
					}
				}}
				style={{
					appearance: "none",
					background: T.surfaceLow,
					color: T.text,
					border: `0.5px solid ${T.border}`,
					borderRadius: 6,
					padding: "7px 9px",
					fontSize: 13,
					fontFamily: mono ? T.mono : T.sans,
					outline: "none",
					transition: "border-color 80ms ease",
				}}
				onFocus={(e) => {
					e.currentTarget.style.borderColor = T.accentBorder;
				}}
				onBlur={(e) => {
					e.currentTarget.style.borderColor = T.border;
				}}
			/>
			{hint ? (
				<span
					style={{
						fontSize: 11,
						color: hintError ? T.danger : T.textFaint,
					}}
				>
					{hint}
				</span>
			) : null}
		</label>
	);
}

/**
 * Row of dots for picking a chip color (worktrees + session groups share
 * the same palette). The selected dot renders a matching-color ring via
 * `boxShadow` so the picker reads at a glance without a separate checkmark
 * glyph.
 *
 * Single source of truth: `WORKTREE_COLOR_MAP` is `Record<WorktreeColor, …>`,
 * so adding/removing a palette entry forces a map edit, which lands here
 * for free instead of drifting out of sync with a second hardcoded list.
 */
const COLOR_OPTIONS = Object.keys(WORKTREE_COLOR_MAP) as WorktreeColor[];

export function ColorPicker({
	value,
	onChange,
	disabled,
	label = "Color",
}: {
	value: WorktreeColor;
	onChange: (c: WorktreeColor) => void;
	disabled?: boolean;
	label?: string;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<span
				style={{
					fontSize: 11,
					color: T.textDim,
					letterSpacing: 0.2,
				}}
			>
				{label}
			</span>
			<div
				role="radiogroup"
				aria-label={label}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 14,
					// Padding so the selected dot's outer ring (3.5px halo) isn't
					// clipped against the surrounding form controls.
					padding: "4px 4px",
				}}
			>
				{COLOR_OPTIONS.map((k) => {
					const c = WORKTREE_COLOR_MAP[k];
					const selected = value === k;
					return (
						<button
							key={k}
							type="button"
							role="radio"
							aria-checked={selected}
							aria-label={k}
							title={k}
							disabled={disabled}
							onClick={() => onChange(k)}
							style={{
								width: 16,
								height: 16,
								borderRadius: "50%",
								background: c.fg,
								border: `0.5px solid ${c.border}`,
								padding: 0,
								cursor: disabled ? "not-allowed" : "pointer",
								opacity: disabled ? 0.5 : 1,
								// Inner shadow of the modal background creates a 2px
								// gap between the dot and the color ring, so the ring
								// reads as a halo rather than fusing into a bigger dot.
								boxShadow: selected
									? `0 0 0 2px ${T.win}, 0 0 0 3.5px ${c.fg}`
									: "none",
								transition: "box-shadow 80ms ease",
								outline: "none",
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}
