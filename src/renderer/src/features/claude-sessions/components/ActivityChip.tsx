import { useEffect, useState } from "react";
import { T } from "../../../design/tokens";

/**
 * The floating "working ⟳ 32s" chip shown over a live transcript. Shared by
 * the main chat (`SessionChat`) and the sidequest panel so working state
 * looks identical in both — same spinner, same mono label.
 *
 * It's also the stop control. When `onStop` is passed the whole chip becomes
 * a button and grows a trailing "×" at its right edge: the × reads as "close
 * this pill", but the entire pill is the hit target, not just the glyph.
 * Without `onStop` (a status that isn't stoppable) it renders as an inert div.
 *
 * `session` is structural on purpose: the main chat passes a store session,
 * the sidequest panel passes its in-memory `SidequestState` (which has the
 * same three fields but no store row).
 */
export function ActivityChip({
	session,
	hasPending,
	onStop,
	interrupting = false,
}: {
	session: { messages: { ts: number }[]; createdAt: number; status: string };
	hasPending: boolean;
	onStop?: () => void;
	interrupting?: boolean;
}) {
	// Self-contained per-second tick so only this chip re-renders, not the
	// whole transcript tree (which would re-run react-markdown +
	// rehype-highlight for every message every second).
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, []);

	const [hover, setHover] = useState(false);

	if (hasPending) return null;
	if (session.status === "idle") return null;

	const last =
		session.messages.length > 0
			? session.messages[session.messages.length - 1].ts
			: session.createdAt;
	const deltaSec = Math.max(0, Math.floor((Date.now() - last) / 1000));

	const stoppable = !!onStop;
	const active = stoppable && !interrupting;

	// Single muted neutral look — the active/quiet/stalled distinction is
	// just a wall-clock heuristic with no real liveness signal, so we drop it.
	const color = active && hover ? "oklch(0.45 0.008 70)" : "oklch(0.55 0.008 70)";
	const border =
		active && hover
			? "oklch(0.45 0.008 70 / 0.75)"
			: "oklch(0.55 0.008 70 / 0.55)";

	// Interrupting swallows the elapsed clock: a ticking timer next to
	// "stopping…" reads like the turn is still making progress.
	const label = interrupting ? "stopping…" : `working ${formatDelta(deltaSec)}`;

	// Shared geometry — the button branch has to restate the type-ish bits
	// (font, color, background) because buttons don't inherit them.
	const style = {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		height: 22,
		padding: "0 9px",
		borderRadius: 11,
		background: T.surface,
		border: `0.5px solid ${border}`,
		color,
		fontSize: 11.5,
		fontFamily: T.mono,
		fontVariantNumeric: "tabular-nums" as const,
		userSelect: "none" as const,
	};

	const body = (
		<>
			<span
				aria-hidden
				style={{
					display: "inline-block",
					width: 9,
					height: 9,
					border: "1.5px solid currentColor",
					borderRightColor: "transparent",
					borderRadius: "50%",
					animation: "asyncy-spin 0.9s linear infinite",
				}}
			/>
			{label}
			{stoppable ? (
				<svg
					width="8"
					height="8"
					viewBox="0 0 8 8"
					aria-hidden
					style={{
						marginLeft: 1,
						opacity: active && hover ? 1 : 0.6,
						overflow: "visible",
					}}
				>
					<path
						d="M0.75 0.75 L7.25 7.25 M7.25 0.75 L0.75 7.25"
						stroke="currentColor"
						strokeWidth="1.25"
						strokeLinecap="round"
					/>
				</svg>
			) : null}
		</>
	);

	if (!stoppable) {
		return <div style={style}>{body}</div>;
	}

	return (
		<button
			type="button"
			onClick={onStop}
			disabled={interrupting}
			aria-label="Stop"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				...style,
				lineHeight: 1,
				cursor: interrupting ? "default" : "pointer",
				opacity: interrupting ? 0.55 : 1,
			}}
		>
			{body}
		</button>
	);
}

function formatDelta(sec: number): string {
	if (sec < 5) return "now";
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
