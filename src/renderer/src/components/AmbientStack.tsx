import type { ReactNode } from "react";

/**
 * The app's single ambient bottom-right column. Everything that floats over
 * the UI without blocking it lives here, stacked newest-concern-on-top.
 *
 * Extracted from `BackgroundTasksIndicator`, which owned this geometry alone
 * until the undo toast needed the same corner. Two independently-fixed
 * elements at the same coordinates would have overlapped, and duplicating the
 * offsets would have meant one of them silently drifting the next time the
 * chat pane's layout changed. One container, one set of decisions:
 *
 *   bottom: 48, not 16
 *     `SessionChat` parks an absolutely-positioned control strip along the
 *     chat pane's bottom edge (the ActivityChip: bottom 0, ~26px tall). It's
 *     right-aligned inside a centred 760px column, so it only nears the window
 *     edge on narrow windows — but there it would collide. A vertical offset
 *     clears it at every width; a horizontal dodge wouldn't.
 *
 *   zIndex: 90
 *     Above in-document layers (SidebarFooter 2, sticky group headers 50) but
 *     deliberately BELOW `.modal-backdrop` (100) and the sidebar context menus
 *     (1000) — a modal is a focus trap and an open menu is transient; neither
 *     should have a floating chip punched through it.
 *
 * `pointerEvents: none` on the container with `auto` on the children means the
 * empty column never swallows clicks aimed at the chat underneath it, which
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
				right: 16,
				bottom: 48,
				zIndex: 90,
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 8,
				userSelect: "none",
				pointerEvents: "none",
			}}
		>
			{children}
		</div>
	);
}
