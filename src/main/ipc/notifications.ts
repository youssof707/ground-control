import { Notification, app } from "electron";
import type { PermissionRequest } from "../../shared/claude-sessions/types";
import * as windows from "../windows";

export class NotificationManager {
	private warnedNoSupport = false;
	private pendingCount = 0;
	private unreadCount = 0;

	notifyPermissionRequest(req: PermissionRequest, sessionTitle?: string) {
		if (!Notification.isSupported()) {
			if (!this.warnedNoSupport) {
				console.warn(
					"[ccw] Notification.isSupported() === false — OS notifications won't fire. " +
						"On macOS check System Settings → Notifications → Electron (in dev) or your app name (in prod).",
				);
				this.warnedNoSupport = true;
			}
			return;
		}

		const body = summarizeInput(req.input);
		const n = new Notification({
			title: `Claude wants to run ${req.toolName}`,
			subtitle: sessionTitle,
			body,
			silent: false,
		});

		n.on("click", () => {
			const win = windows.showAndFocusAny();
			if (!win) return;
			win.webContents.send("notification:clicked", {
				type: "permission",
				requestId: req.requestId,
				sessionId: req.sessionId,
			});
		});

		n.on("show", () => {
			console.log(`[ccw] notification shown: ${req.toolName}`);
		});
		n.on("failed", (_e, error) => {
			console.error("[ccw] notification failed:", error);
		});
		n.on("close", () => {
			// fired when dismissed without click
		});

		try {
			n.show();
		} catch (err) {
			console.error("[ccw] notification show() threw:", err);
		}
	}

	setPendingCount(count: number) {
		this.pendingCount = count;
		this.applyBadge();
	}

	setUnreadCount(count: number) {
		this.unreadCount = Math.max(0, count);
		this.applyBadge();
	}

	private applyBadge() {
		if (process.platform !== "darwin") return;
		// Dock badge only reflects items waiting for user attention
		// (pending permission requests). Unread assistant messages are
		// surfaced in-app via AppNav, not on the dock.
		const total = this.pendingCount;
		app.dock?.setBadge(total > 0 ? String(total) : "");
	}
}

function summarizeInput(input: Record<string, unknown>): string {
	if (typeof input.command === "string") return input.command;
	if (typeof input.file_path === "string") return input.file_path;
	if (typeof input.path === "string") return input.path;
	const json = JSON.stringify(input);
	return json.length > 140 ? json.slice(0, 137) + "..." : json;
}
