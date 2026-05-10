import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
	PermissionDecision,
	PermissionRequest,
} from "../../shared/claude-sessions/types";
import { NotificationManager } from "../ipc/notifications";

type Resolver = (result: PermissionResult) => void;

export class PermissionBroker {
	private pending = new Map<
		string,
		{ request: PermissionRequest; resolve: Resolver }
	>();

	constructor(
		private getWin: () => BrowserWindow | null,
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
			const win = this.getWin();
			if (!win || win.isDestroyed()) {
				this.pending.delete(requestId);
				this.syncBadge();
				resolve({ behavior: "deny", message: "No window available" });
				return;
			}
			win.webContents.send("permission:request", request);
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
			}
		}
		this.syncBadge();
	}

	private handleResponse(d: PermissionDecision) {
		const entry = this.pending.get(d.requestId);
		if (!entry) return;
		this.pending.delete(d.requestId);
		this.syncBadge();
		if (d.behavior === "allow") {
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
