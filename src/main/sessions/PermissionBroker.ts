import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
	PermissionDecision,
	PermissionRequest,
} from "../../shared/claude-sessions/types";
import { NotificationManager } from "../ipc/notifications";
import * as windows from "../windows";

type Resolver = (result: PermissionResult) => void;

export class PermissionBroker {
	private pending = new Map<
		string,
		{ request: PermissionRequest; resolve: Resolver }
	>();
	// Tool names the user has chosen to always allow for the lifetime of this
	// app process. Not persisted — clearing the set requires restarting the app.
	private alwaysAllowTools = new Set<string>();

	constructor(
		private notifications: NotificationManager,
		private getSessionTitle: (sessionId: string) => string | undefined,
	) {
		ipcMain.on("permission:respond", (_e, decision: PermissionDecision) => {
			this.handleResponse(decision);
		});
	}

	ask(args: {
		sessionId: string;
		toolName: string;
		input: Record<string, unknown>;
	}): Promise<PermissionResult> {
		if (this.alwaysAllowTools.has(args.toolName)) {
			return Promise.resolve({
				behavior: "allow",
				updatedInput: args.input,
			});
		}

		const requestId = randomUUID();
		const request: PermissionRequest = {
			requestId,
			sessionId: args.sessionId,
			toolName: args.toolName,
			input: args.input,
			createdAt: Date.now(),
		};

		return new Promise<PermissionResult>((resolve) => {
			this.pending.set(requestId, { request, resolve });
			this.syncBadge();
			if (windows.count() === 0) {
				this.pending.delete(requestId);
				this.syncBadge();
				resolve({ behavior: "deny", message: "No window available" });
				return;
			}
			windows.broadcast("permission:request", request);
			this.notifications.notifyPermissionRequest(
				request,
				this.getSessionTitle(args.sessionId),
			);
		});
	}

	cancelAllForSession(sessionId: string, reason = "Session cancelled") {
		for (const [id, entry] of this.pending) {
			if (entry.request.sessionId === sessionId) {
				this.pending.delete(id);
				entry.resolve({ behavior: "deny", message: reason });
				windows.broadcast("permission:resolved", { requestId: id });
			}
		}
		this.syncBadge();
	}

	private handleResponse(d: PermissionDecision) {
		const entry = this.pending.get(d.requestId);
		if (!entry) return;
		this.pending.delete(d.requestId);
		this.syncBadge();
		windows.broadcast("permission:resolved", { requestId: d.requestId });
		if (d.behavior === "allow") {
			if (d.remember) {
				this.alwaysAllowTools.add(entry.request.toolName);
			}
			entry.resolve({
				behavior: "allow",
				updatedInput: d.updatedInput ?? entry.request.input,
			});
		} else {
			entry.resolve({ behavior: "deny", message: d.message });
		}
	}

	private syncBadge() {
		this.notifications.setPendingCount(this.pending.size);
	}
}
