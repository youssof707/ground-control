import { useEffect, useRef } from "react";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { useSessionCheckout } from "./useSessionCheckout";
import {
	keepOnlyRefreshing,
	lastScanDuration,
	requestRefresh,
	useSourceControlStore,
} from "./useSourceControlStore";

const IDLE_MIN_MS = 15_000;

export function idleDelay(lastDuration: number): number {
	return Math.max(IDLE_MIN_MS, lastDuration * 10);
}

function documentActive(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

export function useSourceControlRefresh(activeSessionId: string | undefined): void {
	const checkout = useSessionCheckout(activeSessionId);
	const modalCheckout = useSourceControlStore((s) => s.modalCheckout);
	const checkoutRef = useRef(checkout);
	checkoutRef.current = checkout;

	useEffect(() => {
		keepOnlyRefreshing([checkout, modalCheckout]);
		if (checkout) requestRefresh(checkout);
	}, [checkout, modalCheckout]);

	useEffect(() => {
		if (!activeSessionId) return;
		let lastStatus = useSessionsStore.getState().sessions[activeSessionId]?.status;
		let lastCount = useSessionsStore.getState().sessions[activeSessionId]?.messages.length ?? 0;
		return useSessionsStore.subscribe((state) => {
			const session = state.sessions[activeSessionId];
			if (!session) return;
			const status = session.status;
			const count = session.messages.length;
			const statusChanged = status !== lastStatus;
			const grew = count !== lastCount;
			const wasRunning = lastStatus === "running";
			lastStatus = status;
			lastCount = count;
			const current = checkoutRef.current;
			if (!current) return;
			if ((statusChanged && wasRunning) || (grew && status === "running")) {
				requestRefresh(current);
			}
		});
	}, [activeSessionId]);

	useEffect(() => {
		const onFocus = (): void => {
			const current = checkoutRef.current;
			if (current) requestRefresh(current);
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	useEffect(() => {
		let timer: number | null = null;
		const schedule = (): void => {
			const current = checkoutRef.current;
			const delay = idleDelay(current ? lastScanDuration(current) : 0);
			timer = window.setTimeout(() => {
				const now = checkoutRef.current;
				if (now && documentActive()) requestRefresh(now);
				schedule();
			}, delay);
		};
		schedule();
		return () => {
			if (timer !== null) window.clearTimeout(timer);
		};
	}, []);
}
