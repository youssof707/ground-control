import { useEffect } from "react";
import type {
	ClaudeSession,
	ClaudeSessionFull,
	PermissionRequest,
	SessionMessage,
	SessionStatus,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";

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

		// Hydrate from the main-process store on first mount.
		void window.claude.listSessions().then((sessions: ClaudeSessionFull[]) => {
			hydrate(sessions);
		});

		const offs = [
			window.claude.on("session:started", (p) => {
				upsertSession(p as ClaudeSession);
			}),
			window.claude.on("session:status", (p) => {
				const { sessionId, status, diff } = p as {
					sessionId: string;
					status: SessionStatus;
					diff?: string;
				};
				setStatus(sessionId, status);
				if (diff !== undefined) upsertSession({ id: sessionId, diff });
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
				const { sessionId, diff } = p as {
					sessionId: string;
					diff?: string;
				};
				setStatus(sessionId, "done");
				if (diff !== undefined) upsertSession({ id: sessionId, diff });
			}),
			window.claude.on("session:errored", (p) => {
				const { sessionId, diff } = p as {
					sessionId: string;
					error?: string;
					diff?: string;
				};
				setStatus(sessionId, "errored");
				if (diff !== undefined) upsertSession({ id: sessionId, diff });
			}),
			window.claude.on("session:cancelled", (p) => {
				const { sessionId, diff } = p as {
					sessionId: string;
					diff?: string;
				};
				setStatus(sessionId, "cancelled");
				if (diff !== undefined) upsertSession({ id: sessionId, diff });
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
		hydrate,
		enqueuePermission,
		removePermission,
	]);
}

function stringifyToolResultContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => {
				if (b && typeof b === "object" && "text" in b) {
					return String((b as { text: unknown }).text ?? "");
				}
				try {
					return JSON.stringify(b);
				} catch {
					return String(b);
				}
			})
			.join("\n");
	}
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

function logMessageErrors(sessionId: string, message: SessionMessage): void {
	const sdk = message.content as {
		type?: string;
		is_error?: boolean;
		subtype?: string;
		result?: unknown;
		message?: { content?: unknown };
	};
	if (!sdk || typeof sdk !== "object") return;

	if (sdk.type === "result") {
		if (sdk.is_error || (sdk.subtype && sdk.subtype !== "success")) {
			console.error(
				`[ccw][session ${sessionId}] result error subtype=${sdk.subtype ?? "unknown"}`,
				sdk.result ?? sdk,
			);
		}
		return;
	}

	if (sdk.type === "user") {
		const inner = sdk.message?.content;
		if (!Array.isArray(inner)) return;
		for (const block of inner) {
			if (!block || typeof block !== "object") continue;
			const b = block as {
				type?: string;
				is_error?: boolean;
				tool_use_id?: string;
				content?: unknown;
			};
			if (b.type !== "tool_result") continue;
			const text = stringifyToolResultContent(b.content);
			if (b.is_error || /<tool_use_error>|InputValidationError/.test(text)) {
				console.error(
					`[ccw][session ${sessionId}] tool_result error tool_use_id=${b.tool_use_id ?? "?"}\n${text}`,
				);
			}
		}
	}
}
