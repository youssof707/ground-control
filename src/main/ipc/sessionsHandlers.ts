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
import * as notesStore from "../core/store/session_notes";
import { broadcast } from "../windows";
import { registerReadHandlers } from "./readHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerAppInfoHandlers } from "./appInfoHandlers";
import { registerNotesHandlers } from "./notesHandlers";

export function registerSessionsHandlers(): SessionManager {
	const notifications = new NotificationManager();
	let manager: SessionManager;
	const broker = new PermissionBroker(
		notifications,
		(sessionId) => manager?.getSession(sessionId)?.title,
		// Re-anchor the branch baseline when the user answers a permission /
		// plan / ask-user prompt. Same hook as sending a message.
		(sessionId) => manager?.snapshotBranchCheckpoint(sessionId),
	);
	manager = new SessionManager(broker);

	registerReadHandlers();
	registerSettingsHandlers();
	registerAppInfoHandlers();
	registerNotesHandlers();

	ipcMain.handle("session:start", (_e, input: StartSessionInput) =>
		manager.run(input),
	);
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
	ipcMain.handle("session:refreshBranch", (_e, sessionId: string) =>
		manager.refreshBranch(sessionId),
	);
	ipcMain.handle(
		"session:switchBranch",
		(_e, payload: { sessionId: string; branch: string }) =>
			manager.switchBranchInSession(payload.sessionId, payload.branch),
	);
	ipcMain.handle(
		"session:fork",
		async (e, payload: { sessionId: string; messageId: string }) => {
			const newSession = await manager.fork(
				payload.sessionId,
				payload.messageId,
			);
			// Structural ping → other windows refetch and see the new session
			// in their lists. Originator already received it via session:started.
			broadcast("state:changed", undefined, e.sender.id);
			return newSession;
		},
	);
	ipcMain.handle(
		"session:setMode",
		async (e, payload: { sessionId: string; mode: SessionMode }) => {
			await manager.setMode(payload.sessionId, payload.mode);
			// Skip the originator — its UI updated from the IPC response and from
			// the existing `session:patch` broadcast SessionManager fires.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	ipcMain.handle("sessions:list", () => sessionStore.listSessions());
	ipcMain.handle("permissions:list", () => broker.listPending());
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
		async (e, payload: { sessionId: string; title: string }) => {
			const title = payload.title.trim().slice(0, 200);
			if (!title) throw new Error("Title cannot be empty");
			const updated = await sessionStore.updateSession(payload.sessionId, {
				title,
			});
			if (!updated) throw new Error("Session not found");
			// Existing incremental event so other windows update title without a
			// full refetch.
			broadcast("session:patch", { sessionId: payload.sessionId, title });
			// Safety-net structural ping for any window that might have missed
			// the patch (e.g. attached its listener after the patch fired).
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	ipcMain.handle("session:delete", async (e, sessionId: string) => {
		// Tombstone first — synchronous. Any subsequent SDK event for this
		// session id is dropped by SessionManager.send, so leaked status /
		// cancelled / message / patch broadcasts from the still-winding-down
		// loop can't reach any window and lazy-resurrect the row via
		// upsertSession.
		manager.markDeleted(sessionId);
		// Trip the abort signal so the SDK loop breaks out on its next tick.
		// We don't await its `done` here: captureDiff inside the cancelled
		// branch can be slow on a large repo, and the tombstone above means
		// we don't need its broadcasts anyway.
		manager.cancel(sessionId);
		// Resolve any pending permission promises for this session and broadcast
		// permission:resolved so the renderer's inbox queue clears. Redundant
		// for sessions that were running (the loop's cancelled branch already
		// called this), but the safety net for non-running sessions.
		broker.cancelAllForSession(sessionId, "Session deleted");
		// Persist the deletes. The store-level tombstone in deleteSession()
		// is set synchronously, so any appendMessage / updateSession tasks
		// from the SDK loop that were already queued ahead of these on the
		// shared write_queue short-circuit (Set check, no file write) and
		// drain quickly instead of forcing a full-file flush per message.
		await sessionStore.deleteSession(sessionId);
		// Cascade-delete any notes attached to this session. Awaited before
		// broadcasting so other windows don't briefly see notes attached to a
		// missing session during a refetch.
		await notesStore.deleteAllForSession(sessionId);
		// Structural ping → other windows refetch and drop this session from
		// their stores. Originator already removed it locally.
		broadcast("state:changed", undefined, e.sender.id);
		// Graceful SDK loop drain in the background. This is what used to
		// block the IPC critical path; now the renderer doesn't wait on it.
		// The tombstone in SessionManager.send filters any of its emitted
		// events; the store-level tombstone no-ops any of its writes.
		void manager.cancelAndWait(sessionId).catch((err) => {
			console.error("[ccw] background cancelAndWait failed:", err);
		});
	});

	return manager;
}
