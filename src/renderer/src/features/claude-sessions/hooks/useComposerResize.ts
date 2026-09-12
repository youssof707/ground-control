import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Shared drag-to-resize + auto-grow model for a composer's textarea, used by
 * both `SessionChat` and the sidequest panel (previously hand-duplicated in
 * each — see `SidequestPanel`'s composer before this hook existed).
 *
 * `height` is the single source of truth for the rendered textarea height.
 * It's updated by either:
 *   (1) the drag handle (any direction, sets it directly), or
 *   (2) content measurement via `onContentHeightChange` — but ONLY to push
 *       the height UP when scrollHeight exceeds the current height. Content
 *       measurement never shrinks `height`, so a manual drag-down is
 *       preserved and the textarea scrolls internally (overflowY: auto)
 *       past the dragged height.
 *
 * `maxHeight` (45% of the window, 120px floor) is recomputed fresh on every
 * call rather than tracked via a resize listener — a quirk inherited
 * verbatim from both original call sites, not fixed here.
 */
export function useComposerResize(opts?: { initialHeight?: number }) {
	const [height, setHeight] = useState(opts?.initialHeight ?? 44);
	const maxHeight = Math.max(120, Math.floor(window.innerHeight * 0.45));
	const dragRef = useRef<{
		startY: number;
		startHeight: number;
		lastHeight: number;
	} | null>(null);
	// Manual-size lock: set true after a drag-DOWN so subsequent typing can't
	// undo the user's deliberate shrink. Released by either a drag-UP past
	// the original size or by the textarea emptying out (e.g. after
	// sending), so each new message starts in auto-grow mode.
	const isManualRef = useRef(false);

	const onContentHeightChange = useCallback(
		(sh: number) => {
			// Textarea is essentially empty (post-send, or all text deleted).
			// Reset the manual lock so the next typing session auto-grows.
			// Empty Chromium textarea with default rows=2 reports
			// scrollHeight ≈ 42–46, so 50 is a safe threshold.
			if (sh <= 50) {
				isManualRef.current = false;
			}
			// While locked (after a drag-down), don't auto-grow — let the
			// textarea's overflowY: auto scroll content internally instead.
			if (isManualRef.current) return;
			setHeight((prev) =>
				sh > prev ? Math.min(maxHeight, Math.max(44, sh)) : prev,
			);
		},
		[maxHeight],
	);

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		dragRef.current = {
			startY: e.clientY,
			startHeight: height,
			lastHeight: height,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ns-resize";
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		const delta = e.clientY - d.startY;
		const next = Math.min(maxHeight, Math.max(44, d.startHeight - delta));
		d.lastHeight = next;
		setHeight(next);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		// Apply the manual-lock rule from the drag's final direction:
		// drag-down locks the smaller size; drag-up releases any prior lock.
		// A click without movement leaves the flag unchanged.
		if (d.lastHeight < d.startHeight) {
			isManualRef.current = true;
		} else if (d.lastHeight > d.startHeight) {
			isManualRef.current = false;
		}
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
	};

	return {
		height,
		onContentHeightChange,
		dividerProps: {
			onPointerDown,
			onPointerMove,
			onPointerUp: endDrag,
			onPointerCancel: endDrag,
		},
	};
}
