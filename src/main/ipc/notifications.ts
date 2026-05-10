import { Notification, app } from "electron";
import type { PermissionRequest } from "../../shared/claude-sessions/types";
import * as windows from "../windows";

export class NotificationManager {
	notifyPermissionRequest(req: PermissionRequest, sessionTitle?: string) {
		const n = new Notification({
			title: `Claude wants to run ${req.toolName}`,
			subtitle: sessionTitle,
			body: summarizeInput(req.input),
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

		n.show();
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
