import { useCallback, useRef, type MouseEvent } from "react";

/**
 * Dismiss-on-backdrop-click that only fires for a *deliberate* backdrop click:
 * the press must both start and end on the backdrop itself.
 *
 * Why not `onClick` + `e.target === e.currentTarget`: a native click fires on the
 * nearest common ancestor of the mousedown and mouseup targets, so dragging from
 * inside the card out onto the backdrop produces a click whose target IS the
 * backdrop. Text-selection drags would still dismiss and destroy typed input.
 * Arming on mousedown and resolving on mouseup is the only way to tell the two
 * apart.
 *
 * Pass `undefined` to disable dismissal entirely (see UpdateModal's
 * install-in-progress lock).
 */
export function useBackdropDismiss(onDismiss: (() => void) | undefined) {
	const armed = useRef(false);

	const onMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
		armed.current = e.button === 0 && e.target === e.currentTarget;
	}, []);

	const onMouseUp = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			const wasArmed = armed.current;
			armed.current = false;
			if (!wasArmed) return;
			if (e.button !== 0) return;
			if (e.target !== e.currentTarget) return; // released over the card
			onDismiss?.();
		},
		[onDismiss],
	);

	return { onMouseDown, onMouseUp, role: "presentation" as const };
}
