import { Notification, app } from "electron";
import type { PermissionRequest } from "../../shared/claude-sessions/types";
import * as windows from "../windows";

export class NotificationManager {
	private warnedNoSupport = false;

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
		if (process.platform !== "darwin") return;
		app.dock?.setBadge(count > 0 ? String(count) : "");
	}
}

function summarizeInput(input: Record<string, unknown>): string {
	if (typeof input.command === "string") return input.command;
	if (typeof input.file_path === "string") return input.file_path;
	if (typeof input.path === "string") return input.path;
	const json = JSON.stringify(input);
	return json.length > 140 ? json.slice(0, 137) + "..." : json;
}
