import { useEffect } from "react";
import type {
	ClaudeSession,
	PermissionRequest,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";

interface SdkMessageLike {
	type?: string;
	[k: string]: unknown;
}

function roleFromSdkMessage(
	msg: SdkMessageLike,
): "assistant" | "user" | "system" | "result" {
	if (msg?.type === "assistant") return "assistant";
	if (msg?.type === "user") return "user";
	if (msg?.type === "system") return "system";
	return "result";
}

export function useSessionsBootstrap() {
	const upsertSession = useSessionsStore((s) => s.upsertSession);
	const appendMessage = useSessionsStore((s) => s.appendMessage);
	const setStatus = useSessionsStore((s) => s.setStatus);
	const enqueuePermission = usePermissionsStore((s) => s.enqueue);
	const removePermission = usePermissionsStore((s) => s.remove);

	useEffect(() => {
		if (!window.claude) {
			console.error(
				"[ccw] window.claude is undefined — preload likely failed to load",
			);
			return;
		}
		const offs = [
			window.claude.on("session:started", (p) => {
				upsertSession(p as ClaudeSession);
			}),
			window.claude.on("session:message", (p) => {
				const { sessionId, msg } = p as {
					sessionId: string;
					msg: SdkMessageLike;
				};
				appendMessage(sessionId, {
					id: crypto.randomUUID(),
					role: roleFromSdkMessage(msg),
					content: msg,
					ts: Date.now(),
				});
			}),
			window.claude.on("session:done", (p) => {
				const { sessionId } = p as { sessionId: string };
				setStatus(sessionId, "done");
			}),
			window.claude.on("session:errored", (p) => {
				const { sessionId } = p as { sessionId: string; error?: string };
				setStatus(sessionId, "errored");
			}),
			window.claude.on("session:cancelled", (p) => {
				const { sessionId } = p as { sessionId: string };
				setStatus(sessionId, "cancelled");
				// Drop any pending permission cards for this session.
				const queue = usePermissionsStore.getState().queue;
				for (const r of queue) {
					if (r.sessionId === sessionId) removePermission(r.requestId);
				}
			}),
			window.claude.on("permission:request", (p) => {
				enqueuePermission(p as PermissionRequest);
			}),
		];
		return () => offs.forEach((off) => off());
	}, [
		upsertSession,
		appendMessage,
		setStatus,
		enqueuePermission,
		removePermission,
	]);
}
