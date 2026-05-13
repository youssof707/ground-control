import { useEffect, useState } from "react";
import { T } from "../../../design/tokens";
import { useRateLimitStore } from "../stores/useRateLimitStore";

/**
 * Inline rate-limit chip rendered inside `SidebarFooter` — stacks above the
 * version chip with matching typography (10px mono, `textFaint`) so the
 * footer reads as one coherent meta-bar. Reflects the user's Claude.ai
 * 5-hour-window state from `SDKRateLimitEvent` messages.
 *
 * Visibility:
 *   - Shows the reset countdown whenever the SDK has reported a future
 *     `resetsAt` for the five-hour window. That's effectively "any time
 *     you've made an SDK call in the last 5 hours on a claude.ai account."
 *   - Prefixes "X% used - " only when the SDK also fills `utilization`,
 *     which it does once the account crosses an internal warn threshold
 *     (~80%). Below that threshold the prefix is omitted because the
 *     number doesn't exist — never faked as 0%.
 *   - Returns `null` when no event has arrived (boot, or
 *     ANTHROPIC_API_KEY callers where the event never fires) or when
 *     `resetsAt` is missing/elapsed — this is what lets the footer
 *     collapse to a single version line in the empty state.
 */
export function RateLimitMeter() {
	const info = useRateLimitStore((s) => s.byType.five_hour);

	// 60s tick so "resets in Nm" stays current between SDK events.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, []);

	if (!info) return null;
	const resetsIn = formatDuration(info.resetsAt, now);
	if (!resetsIn) return null;

	const hasNumeric = typeof info.utilization === "number";
	const utilization = clamp01(info.utilization ?? 0);
	const pct = hasNumeric ? Math.round(utilization * 100) : 0;

	// "Close" = SDK has flipped status to warn/rejected, OR (defensively) the
	// numeric utilization itself crossed 80%. The Agent SDK only fills
	// `utilization` at all once it's near a threshold, so this dot is
	// effectively shown whenever we have a number to show.
	const isClose =
		info.status === "allowed_warning" ||
		info.status === "rejected" ||
		(hasNumeric && utilization >= 0.8);

	return (
		<div
			style={{
				fontSize: 10,
				fontFamily: T.mono,
				color: T.textFaint,
				userSelect: "none",
				letterSpacing: 0.2,
				fontVariantNumeric: "tabular-nums",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
			}}
		>
			{isClose ? (
				<span
					aria-hidden
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: T.warn,
						flexShrink: 0,
					}}
				/>
			) : null}
			<span>
				Usage resets in {resetsIn}
				{hasNumeric ? ` - ${pct}% used` : ""}
			</span>
		</div>
	);
}

function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

/**
 * Render the time until `resetsAt` (epoch seconds, per SDK docs) as a
 * compact duration: "32m" / "4h" / "4h 12m". Returns null when the value
 * is missing or already elapsed (the SDK will push a fresh event on the
 * next turn).
 */
function formatDuration(
	resetsAt: number | undefined,
	now: number,
): string | null {
	if (!resetsAt) return null;
	// SDK gives epoch seconds; multiply to ms. Defensive: if the value already
	// looks like ms (>1e12 ≈ year 2001+ in ms), use it directly.
	const ms = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
	const diffMs = ms - now;
	if (diffMs <= 0) return null;
	const totalMin = Math.ceil(diffMs / 60_000);
	if (totalMin < 60) return `${totalMin}m`;
	const hours = Math.floor(totalMin / 60);
	const mins = totalMin % 60;
	return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
