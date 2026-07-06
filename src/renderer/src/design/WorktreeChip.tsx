import type { CSSProperties } from "react";
import { T } from "./tokens";

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
 * Palette borrows the `info` accent so the chip reads as an "attached
 * sandbox" affordance without competing with the green/red BranchChip
 * next to it.
 */
export function WorktreeChip({
	displayName,
	variant,
	small = false,
	onDetach,
}: {
	displayName: string;
	variant: "interactive" | "readonly";
	small?: boolean;
	onDetach?: () => void;
}) {
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
		background: T.infoSoft,
		border: `0.5px solid ${T.infoBorder}`,
		fontSize,
		color: T.info,
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
						color: T.info,
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
