import { ipcMain, BrowserWindow } from "electron";
import { SessionManager } from "../sessions/SessionManager";
import { PermissionBroker } from "../sessions/PermissionBroker";
import { NotificationManager } from "./notifications";
import type { StartSessionInput } from "../../shared/claude-sessions/types";

export function registerSessionsHandlers(getWin: () => BrowserWindow | null) {
	const notifications = new NotificationManager(getWin);
	let manager: SessionManager;
	const broker = new PermissionBroker(
		getWin,
		notifications,
		(sessionId) => manager?.getSession(sessionId)?.title,
	);
	manager = new SessionManager(getWin, broker);

	ipcMain.handle("session:start", (_e, input: StartSessionInput) => manager.run(input));
	ipcMain.handle("session:cancel", (_e, sessionId: string) => {
		manager.cancel(sessionId);
	});
}
