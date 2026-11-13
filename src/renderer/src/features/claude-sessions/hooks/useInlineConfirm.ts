import { useCallback, useEffect, useRef, useState } from "react";

const CONFIRM_REVERT_MS = 3000;

export function useInlineConfirm(action: () => void, needsConfirm = true) {
	const [confirming, setConfirming] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimer = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = null;
	}, []);

	useEffect(() => clearTimer, [clearTimer]);

	const reset = useCallback(() => {
		clearTimer();
		setConfirming(false);
	}, [clearTimer]);

	const click = useCallback(() => {
		if (needsConfirm && !confirming) {
			setConfirming(true);
			clearTimer();
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				setConfirming(false);
			}, CONFIRM_REVERT_MS);
			return;
		}
		reset();
		action();
	}, [action, needsConfirm, confirming, clearTimer, reset]);

	return { confirming: needsConfirm && confirming, click, reset };
}
