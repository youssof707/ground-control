import type { ReactNode } from "react";

/**
 * The app's single ambient bottom-LEFT column. Everything that floats over the
 * UI without blocking it lives here, stacked newest-concern-on-top.
 *
 * Extracted from `BackgroundTasksIndicator`, which owned this geometry alone
 * until the undo toast needed the same corner. Two independently-fixed
 * elements at the same coordinates would have overlapped, and duplicating the
 * offsets would have meant one of them silently drifting the next time the
 * layout changed. One container, one set of decisions:
 *
 *   left, not right
 *     This corner is low-priority chrome, and the right side is the chat
 *     pane's reading path — a card parked there sits between the transcript
 *     and the composer and has to be actively ignored. On the left it lands
 *     over the sessions sidebar, collecting with the other ambient status
 *     (rate-limit meter, version chip) in one quiet corner.
 *
 *   bottom: 56
 *     Clears `SidebarFooter`, which is `position: absolute; bottom: 0` inside
 *     the sidebar pane. Its height is content-derived, not fixed (~46-50px
 *     with the rate-limit meter, ~31px when the meter has nothing to show), so
 *     56 is the reserve rather than a measurement — the same 56 `SessionsList`
 *     already uses as `paddingBottom` to keep its last row clear of that
 *     footer. Deliberately NOT a ResizeObserver: this column is ambient, and a
 *     few px of slack in the footer's short state costs nothing.
 *
 *   zIndex: 90
 *     Above in-document layers (SidebarFooter 2, sticky group headers 50) but
 *     deliberately BELOW `.modal-backdrop` (100) and the sidebar context menus
 *     (1000) — a modal is a focus trap and an open menu is transient; neither
 *     should have a floating chip punched through it.
 *
 * Children are wider than the sidebar's 260px minimum (the cards are 360px),
 * so the column overhangs the sidebar's right edge into the chat pane. That's
 * intended — the alternative is a cramped card or one that resizes as the
 * sidebar is dragged.
 *
 * `pointerEvents: none` on the container with `auto` on the children means the
 * empty column never swallows clicks aimed at the sidebar underneath it, which
 * matters because children here render `null` most of the time.
 *
 * NOTE: this repo has a hard no-tooltip rule. Every label in here must be
 * visibly rendered text; do not add `title` attributes or hover-reveal bubbles.
 */
export function AmbientStack({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				position: "fixed",
				left: 16,
				bottom: 56,
				zIndex: 90,
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-start",
				gap: 8,
				userSelect: "none",
				pointerEvents: "none",
			}}
		>
			{children}
		</div>
	);
}
