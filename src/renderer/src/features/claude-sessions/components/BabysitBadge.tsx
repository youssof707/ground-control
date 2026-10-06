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
 * Two hit targets in one pill: the label opens the Babysitter modal to edit
 * the rules; the trailing × kills the babysitter instantly, no confirm. The
 * pill itself is a plain container because a button can't nest a button.
 * The row is wrapped in a `<Link>`, hence the swallowed clicks (same pattern
 * as the usage-limit pill and `RowMenuButton`).
 */
export function BabysitBadge({ sessionId }: { sessionId: string }) {
	// Primitive selector: rows sit on the streaming path, so re-render only
	// when this session's on/off state flips, not on every config edit.
	const active = useBabysitStore((s) => !!s.bySession[sessionId]);
	const [hover, setHover] = useState(false);
	const [xHover, setXHover] = useState(false);
	if (!active) return null;

	const stop = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const store = useBabysitStore.getState();
		const prev = store.bySession[sessionId];
		// Optimistic: the badge vanishes on click. Main also broadcasts
		// `babysit:changed`; if the write fails, put the config back so the
		// badge doesn't lie about a babysitter that's still answering.
		store.apply(sessionId, null);
		window.claude.setBabysit(sessionId, null).catch(() => {
			if (prev) useBabysitStore.getState().apply(sessionId, prev);
		});
	};

	return (
		<div
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: 22,
				borderRadius: 11,
				background: hover
					? `color-mix(in oklab, ${T.babysit} 24%, transparent)`
					: T.babysitSoft,
				border: `0.5px solid ${T.babysitBorder}`,
				flexShrink: 0,
				overflow: "hidden",
				transition: "background 80ms ease",
			}}
		>
			<button
				type="button"
				aria-label="Babysitting. Open babysitter settings"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					useBabysitStore.getState().openModal(sessionId);
				}}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					height: "100%",
					padding: "0 4px 0 9px",
					border: "none",
					background: "transparent",
					fontSize: 11.5,
					fontFamily: "inherit",
					fontWeight: 500,
					letterSpacing: "0.1px",
					color: T.babysit,
					whiteSpace: "nowrap",
					cursor: "pointer",
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
			<button
				type="button"
				aria-label="Stop babysitting"
				onClick={stop}
				onMouseEnter={() => setXHover(true)}
				onMouseLeave={() => setXHover(false)}
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					height: "100%",
					padding: "0 8px 0 3px",
					border: "none",
					background: "transparent",
					color: T.babysit,
					opacity: xHover ? 1 : 0.6,
					cursor: "pointer",
					transition: "opacity 80ms ease",
				}}
			>
				<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
					<path
						d="M1 1l6 6M7 1L1 7"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}
