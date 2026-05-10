import { BrowserWindow, dialog, ipcMain } from "electron";
import { SessionManager } from "../sessions/SessionManager";
import { PermissionBroker } from "../sessions/PermissionBroker";
import { NotificationManager } from "./notifications";
import type {
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../../shared/schemas/claude_session";
import * as sessionStore from "../core/store/claude_session";
import { broadcast } from "../windows";

export function registerSessionsHandlers(): SessionManager {
	const notifications = new NotificationManager();
	let manager: SessionManager;
	const broker = new PermissionBroker(
		notifications,
		(sessionId) => manager?.getSession(sessionId)?.title,
	);
	manager = new SessionManager(broker);

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
	ipcMain.handle(
		"session:setMode",
		(_e, payload: { sessionId: string; mode: SessionMode }) =>
			manager.setMode(payload.sessionId, payload.mode),
	);
	ipcMain.handle("sessions:list", () => sessionStore.listSessions());
	ipcMain.on("notifications:setUnreadCount", (_e, count: number) => {
		notifications.setUnreadCount(typeof count === "number" ? count : 0);
	});
	ipcMain.handle(
		"dialog:pickFolder",
		async (
			e,
			opts: { defaultPath?: string } = {},
		): Promise<string | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			const result = win
				? await dialog.showOpenDialog(win, {
						properties: ["openDirectory", "createDirectory"],
						defaultPath: opts.defaultPath,
					})
				: await dialog.showOpenDialog({
						properties: ["openDirectory", "createDirectory"],
						defaultPath: opts.defaultPath,
					});
			if (result.canceled || result.filePaths.length === 0) return null;
			return result.filePaths[0];
		},
	);
	ipcMain.handle(
		"session:rename",
		async (_e, payload: { sessionId: string; title: string }) => {
			const title = payload.title.trim().slice(0, 200);
			if (!title) throw new Error("Title cannot be empty");
			const updated = await sessionStore.updateSession(payload.sessionId, {
				title,
			});
			if (!updated) throw new Error("Session not found");
			broadcast("session:patch", { sessionId: payload.sessionId, title });
		},
	);
	ipcMain.handle("session:delete", async (_e, sessionId: string) => {
		// If the session is still alive, cancel it first. The live loop will
		// wind down on its own; its late writes are no-ops because the store
		// row is gone.
		if (manager.getSession(sessionId)) {
			manager.cancel(sessionId);
		}
		await sessionStore.deleteSession(sessionId);
	});

	return manager;
}
