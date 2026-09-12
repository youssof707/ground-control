import type { PointerEvent as ReactPointerEvent } from "react";
import { T } from "../../../design/tokens";

/**
 * The drag-to-resize handle above a composer's textarea — a thin hit target
 * with a 1px visible line, shared by `SessionChat` and the sidequest panel.
 * Pair with `useComposerResize`'s `dividerProps`.
 *
 * `DraftSessionChat` renders the `static` variant: a draft has no drag
 * handle (no `useComposerResize` pointer handlers wired up there), just the
 * same visual line for consistency with the two live variants.
 */
export function ComposerDivider({
	ariaLabel,
	static: isStatic,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
}: {
	ariaLabel: string;
	static?: boolean;
	onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
	onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
	onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
	onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
	return (
		<div
			{...(isStatic
				? { "aria-hidden": true }
				: {
					onPointerDown,
					onPointerMove,
					onPointerUp,
					onPointerCancel,
					role: "separator" as const,
					"aria-orientation": "horizontal" as const,
					"aria-label": ariaLabel,
				})}
			style={{
				flexShrink: 0,
				height: 6,
				cursor: isStatic ? "default" : "ns-resize",
				display: "flex",
				alignItems: "center",
				touchAction: "none",
			}}
		>
			<div style={{ height: 1, width: "100%", background: T.borderSoft }} />
		</div>
	);
}
