import { ipcMain, BrowserWindow } from "electron";
import { SessionManager } from "../sessions/SessionManager";
import { PermissionBroker } from "../sessions/PermissionBroker";
import { NotificationManager } from "./notifications";
import type {
	StartSessionInput,
	UserTurn,
} from "../../shared/schemas/claude_session";
import * as sessionStore from "../core/store/claude_session";

export function registerSessionsHandlers(
	getWin: () => BrowserWindow | null,
): SessionManager {
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
	ipcMain.handle("session:userMessage", (_e, turn: UserTurn) => {
		manager.pushUserMessage(turn.sessionId, turn.blocks);
	});
	ipcMain.handle("session:finish", (_e, sessionId: string) => {
		manager.finish(sessionId);
	});
	ipcMain.handle("session:interrupt", (_e, sessionId: string) =>
		manager.interrupt(sessionId),
	);
	ipcMain.handle("session:resume", (_e, sessionId: string) =>
		manager.resume(sessionId),
	);
	ipcMain.handle("sessions:list", () => sessionStore.listSessions());
	ipcMain.handle("session:delete", async (_e, sessionId: string) => {
		if (manager.getSession(sessionId)) {
			throw new Error(
				"Cancel the session before deleting it (it's still active).",
			);
		}
		await sessionStore.deleteSession(sessionId);
	});

	return manager;
}
