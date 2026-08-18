import type { CSSProperties } from "react";
import type { WorktreeColor } from "@shared/schemas/worktrees";
import { T } from "./tokens";

/**
 * Maps a `WorktreeColor` to the three design tokens the chip needs.
 * Colocated here (not in `tokens.ts`) because it's a feature-level
 * semantic palette — the flat token dictionary should stay flat.
 * Exported so the create-worktree modal's picker can reuse the same
 * mapping instead of redefining tuples.
 *
 * Used to also have "green" and "yellow" entries; both were retired
 * because they collided with existing status colors elsewhere in the
 * app (green = "running", yellow = "waiting for input"). Don't re-add
 * them here without also widening `WorktreeColorSchema` in
 * `shared/schemas/worktrees.ts` — `StoredWorktreeColorSchema` folds
 * legacy green/yellow records onto blue/red on read.
 */
export const WORKTREE_COLOR_MAP: Record<
	WorktreeColor,
	{ fg: string; bg: string; border: string }
> = {
	blue: { fg: T.info, bg: T.infoSoft, border: T.infoBorder },
	red: { fg: T.danger, bg: T.dangerSoft, border: T.dangerBorder },
};

/**
 * Small chip that surfaces the app-owned worktree a session is bound to.
 * The label is the user-provided `displayName` — deliberately distinct
 * from the branch name, and the *only* thing shown on the chip (per
 * product decision).
 *
 * Two variants:
 *   - "interactive" (draft header): renders a small ✕ detach button.
 *     Clicking ✕ clears the draft's `worktreeId`; the underlying
 *     worktree is untouched.
 *   - "readonly" (session header + sidebar rows): no ✕, no click
 *     handler. Sessions are bound to their worktree forever.
 *
 * `color` picks the tint from the 2-value palette above. Defaults to
 * "blue" (matches the previous hardcoded look) so an accidental drop
 * through still renders a valid chip.
 */
export function WorktreeChip({
	displayName,
	variant,
	color = "blue",
	small = false,
	onDetach,
}: {
	displayName: string;
	variant: "interactive" | "readonly";
	color?: WorktreeColor;
	small?: boolean;
	onDetach?: () => void;
}) {
	const c = WORKTREE_COLOR_MAP[color];
	const height = small ? 18 : 22;
	const fontSize = small ? 10.5 : 11.5;
	const radius = height / 2;
	const paddingRight = variant === "interactive" ? 2 : small ? 7 : 9;
	const iconSize = small ? 9 : 11;

	const baseStyle: CSSProperties = {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		height,
		padding: `0 ${paddingRight}px 0 ${small ? 6 : 8}px`,
		borderRadius: radius,
		background: c.bg,
		border: `0.5px solid ${c.border}`,
		fontSize,
		color: c.fg,
		fontWeight: 500,
		letterSpacing: 0.1,
		whiteSpace: "nowrap",
		maxWidth: 200,
		overflow: "hidden",
		textOverflow: "ellipsis",
		flexShrink: 0,
	};

	return (
		<span style={baseStyle} title={`Worktree: ${displayName}`}>
			<svg
				width={iconSize}
				height={iconSize}
				viewBox="0 0 12 12"
				fill="none"
				aria-hidden="true"
				style={{ flexShrink: 0 }}
			>
				{/* Two overlapping folder-ish glyphs — reads as "sandbox / branched folder". */}
				<path
					d="M1.5 3.5V9a1 1 0 0 0 1 1H8"
					stroke="currentColor"
					strokeWidth="1"
					strokeLinecap="round"
				/>
				<path
					d="M3.5 5.5V2.5h2l1 1h4v6.5"
					stroke="currentColor"
					strokeWidth="1"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
			</svg>
			<span
				style={{
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
				}}
			>
				{displayName}
			</span>
			{variant === "interactive" && onDetach ? (
				<button
					type="button"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onDetach();
					}}
					title="Detach worktree from draft"
					aria-label="Detach worktree"
					style={{
						appearance: "none",
						border: "none",
						background: "transparent",
						color: c.fg,
						cursor: "pointer",
						padding: 0,
						marginLeft: 2,
						width: height - 6,
						height: height - 6,
						borderRadius: "50%",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
						opacity: 0.7,
						transition: "opacity 80ms ease, background 80ms ease",
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.opacity = "1";
						e.currentTarget.style.background = "rgba(255,255,255,0.06)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.opacity = "0.7";
						e.currentTarget.style.background = "transparent";
					}}
				>
					<svg
						width={iconSize - 2}
						height={iconSize - 2}
						viewBox="0 0 10 10"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2 2l6 6M8 2l-6 6"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			) : null}
		</span>
	);
}
