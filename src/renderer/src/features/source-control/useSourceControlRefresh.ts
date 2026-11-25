import { useEffect, useRef } from "react";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { call, cancel, type ScmCall } from "./scmClient";
import { useSessionCheckout } from "./useSessionCheckout";
import {
	backgroundFetch,
	keepOnlyRefreshing,
	lastScanDuration,
	requestRefresh,
	useSourceControlStore,
} from "./useSourceControlStore";

const IDLE_MIN_MS = 15_000;
const FETCH_INTERVAL_MS = 5 * 60_000;
const FETCH_MIN_GAP_MS = 60_000;

export function idleDelay(lastDuration: number): number {
	return Math.max(IDLE_MIN_MS, lastDuration * 10);
}

function documentActive(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

export function useSourceControlRefresh(activeSessionId: string | undefined): void {
	const checkout = useSessionCheckout(activeSessionId);
	const modalCheckout = useSourceControlStore((s) => s.modalCheckout);
	const connection = useSourceControlStore((s) => s.connection);
	const checkoutRef = useRef(checkout);
	checkoutRef.current = checkout;

	const lastFetch = useRef(new Map<string, number>());

	useEffect(() => {
		keepOnlyRefreshing([checkout, modalCheckout]);
		if (checkout) requestRefresh(checkout);
	}, [checkout, modalCheckout]);

	useEffect(() => {
		if (!checkout || connection !== "ready") return;
		let active: ScmCall<"watchHead"> | null = null;
		const arm = (): void => {
			const watch = call<"watchHead">({ t: "watchHead", checkout });
			active = watch;
			void watch.promise.then((reply) => {
				if (active !== watch) return;
				active = null;
				if (!reply.ok) return;
				requestRefresh(checkout);
				arm();
			});
		};
		arm();
		return () => {
			const current = active;
			active = null;
			if (current) cancel(current.id);
		};
	}, [checkout, connection]);

	useEffect(() => {
		const fetchIfStale = (minGap: number): void => {
			const current = checkoutRef.current;
			if (!current) return;
			const now = Date.now();
			if (now - (lastFetch.current.get(current) ?? 0) < minGap) return;
			lastFetch.current.set(current, now);
			backgroundFetch(current);
		};
		fetchIfStale(FETCH_MIN_GAP_MS);
		const onFocus = (): void => fetchIfStale(FETCH_MIN_GAP_MS);
		const timer = window.setInterval(() => {
			if (documentActive()) fetchIfStale(FETCH_INTERVAL_MS - 1_000);
		}, FETCH_INTERVAL_MS);
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [checkout]);

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
