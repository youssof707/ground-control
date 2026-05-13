import { useEffect } from "react";
import type {
	ClaudeSession,
	PermissionRequest,
	SessionMessage,
	SessionStatus,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
	useRateLimitStore,
	type RateLimitSnapshot,
} from "../stores/useRateLimitStore";

export function useSessionsBootstrap() {
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	const appendMessage = useSessionsStore((s) => s.appendMessage);
	const setStatus = useSessionsStore((s) => s.setStatus);
	const hydrate = useSessionsStore((s) => s.hydrate);
	const enqueuePermission = usePermissionsStore((s) => s.enqueue);
	const removePermission = usePermissionsStore((s) => s.remove);

	useEffect(() => {
		if (!window.claude) {
			console.error(
				"[ccw] window.claude is undefined — preload likely failed to load",
			);
			return;
		}

		// Per-domain monotonic seq counters: if two refetches are in flight
		// (e.g. user did something locally + a `state:changed` ping arrived),
		// drop any response whose seq isn't the latest. Prevents an older
		// response from clobbering a newer one and causing UI flicker-back.
		const seq = {
			sessions: 0,
			read: 0,
			permissions: 0,
			settings: 0,
			rateLimit: 0,
		};

		async function refetchSessions(): Promise<void> {
			const my = ++seq.sessions;
			const sessions = await window.claude.listSessions();
			if (my !== seq.sessions) return;
			hydrate(sessions);
		}

		async function refetchReadState(): Promise<void> {
			const my = ++seq.read;
			const { lastReadAt } = await window.claude.listReadState();
			if (my !== seq.read) return;
			useReadStore.getState().hydrate(lastReadAt);
		}

		async function refetchPermissions(): Promise<void> {
			const my = ++seq.permissions;
			const queue = await window.claude.listPermissions();
			if (my !== seq.permissions) return;
			for (const req of queue) enqueuePermission(req);
		}

		async function refetchSettings(): Promise<void> {
			const my = ++seq.settings;
			const settings = await window.claude.getSettings();
			if (my !== seq.settings) return;
			useSettingsStore.getState().hydrate(settings);
		}

		async function refetchRateLimit(): Promise<void> {
			const my = ++seq.rateLimit;
			const snapshot = await window.claude.getRateLimit();
			if (my !== seq.rateLimit) return;
			console.log("[ccw][rate-limit] hydrate:", snapshot);
			useRateLimitStore.getState().hydrate(snapshot);
		}

		function refetchAll(): void {
			void refetchSessions();
			void refetchReadState();
			void refetchPermissions();
			void refetchSettings();
			void refetchRateLimit();
		}

		// CRITICAL ORDERING: register the per-event listeners FIRST so that
		// any event arriving between now and when refetchAll's IPC calls
		// resolve is captured. enqueue/upsert dedupe handles overlap.
		const offs = [
			window.claude.on("session:started", (p) => {
				upsertSession(p as ClaudeSession);
			}),
			window.claude.on("session:status", (p) => {
				const { sessionId, status } = p as {
					sessionId: string;
					status: SessionStatus;
				};
				setStatus(sessionId, status);
			}),
			window.claude.on("session:patch", (p) => {
				const { sessionId, ...patch } = p as {
					sessionId: string;
				} & Record<string, unknown>;
				upsertSession({ id: sessionId, ...patch });
			}),
			window.claude.on("session:message", (p) => {
				const { sessionId, message } = p as {
					sessionId: string;
					message: SessionMessage;
				};
				logMessageErrors(sessionId, message);
				appendMessage(sessionId, message);
			}),
			window.claude.on("session:done", (p) => {
				const { sessionId } = p as { sessionId: string };
				setStatus(sessionId, "done");
			}),
			window.claude.on("session:errored", (p) => {
				const { sessionId } = p as {
					sessionId: string;
					error?: string;
				};
				setStatus(sessionId, "errored");
			}),
			window.claude.on("session:cancelled", (p) => {
				const { sessionId } = p as { sessionId: string };
				setStatus(sessionId, "cancelled");
				const queue = usePermissionsStore.getState().queue;
				for (const r of queue) {
					if (r.sessionId === sessionId) removePermission(r.requestId);
				}
			}),
			window.claude.on("permission:request", (p) => {
				enqueuePermission(p as PermissionRequest);
			}),
			window.claude.on("permission:resolved", (p) => {
				const { requestId } = p as { requestId: string };
				removePermission(requestId);
			}),
			// Push channel for the claude.ai subscription rate-limit meter.
			// Main broadcasts the full snapshot every time the SDK emits a
			// `rate_limit_event` (see RateLimitTracker.update), so we can hot-
			// swap our hydrated copy on each push — no diffing needed.
			window.claude.on("rateLimit:update", (p) => {
				console.log("[ccw][rate-limit] push:", p);
				useRateLimitStore.getState().hydrate(p as RateLimitSnapshot);
			}),
			// The structural-change ping. Originating window is skipped by main,
			// so we only get here when *another* window mutated something.
			window.claude.on("state:changed", () => {
				refetchAll();
			}),
		];

		// Initial hydration. Listeners are already attached above, so any
		// event arriving in parallel is captured (and dedupes via the stores'
		// upsert/enqueue logic).
		refetchAll();

		return () => offs.forEach((off) => off());
	}, [
		upsertSession,
		appendMessage,
		setStatus,
		hydrate,
		enqueuePermission,
		removePermission,
	]);
}

function logMessageErrors(sessionId: string, message: SessionMessage): void {
	const sdk = message.content as {
		type?: string;
		is_error?: boolean;
		subtype?: string;
		result?: unknown;
	};
	if (!sdk || typeof sdk !== "object") return;

	if (sdk.type === "result") {
		if (sdk.is_error || (sdk.subtype && sdk.subtype !== "success")) {
			console.error(
				`[ccw][session ${sessionId}] result error subtype=${sdk.subtype ?? "unknown"}`,
				sdk.result ?? sdk,
			);
		}
	}
	// tool_result errors are intentionally not logged — they fire constantly
	// during normal use (permission denials, <tool_use_error>, InputValidationError)
	// and drowned out genuine errors.
}
