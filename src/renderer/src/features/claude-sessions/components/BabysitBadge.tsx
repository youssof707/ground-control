import { useState } from "react";
import { T } from "../../../design/tokens";
import { useBabysitStore } from "../stores/useBabysitStore";

/**
 * Sidebar-row badge shown while a session is being babysat. Renders nothing
 * otherwise, so the row can mount it unconditionally.
 *
 * Shares `StatusPill`'s geometry so it sits flush in the chips row, but is
 * deliberately NOT a status: its orchid colour belongs to no entry in
 * `STATUS_MAP`, and it appears alongside the status pill rather than
 * replacing it — "running, and being babysat" are two separate facts.
 *
 * Clicking opens the Babysitter modal to edit the rules or stop. The row is
 * wrapped in a `<Link>`, hence the swallowed click (same pattern as the
 * usage-limit pill and `RowMenuButton`).
 */
export function BabysitBadge({ sessionId }: { sessionId: string }) {
	// Primitive selector: rows sit on the streaming path, so re-render only
	// when this session's on/off state flips, not on every config edit.
	const active = useBabysitStore((s) => !!s.bySession[sessionId]);
	const [hover, setHover] = useState(false);
	if (!active) return null;
	return (
		<button
			type="button"
			aria-label="Babysitting. Open babysitter settings"
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				useBabysitStore.getState().openModal(sessionId);
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: hover
					? `color-mix(in oklab, ${T.babysit} 24%, transparent)`
					: T.babysitSoft,
				border: `0.5px solid ${T.babysitBorder}`,
				fontSize: 11.5,
				fontFamily: "inherit",
				fontWeight: 500,
				letterSpacing: "0.1px",
				color: T.babysit,
				whiteSpace: "nowrap",
				flexShrink: 0,
				cursor: "pointer",
				transition: "background 80ms ease",
			}}
		>
			{/* Same 6px dot the status pills use — the orchid is what sets it
			    apart, not the shape. */}
			<span
				aria-hidden
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: T.babysit,
					flexShrink: 0,
				}}
			/>
			babysitting
		</button>
	);
}
