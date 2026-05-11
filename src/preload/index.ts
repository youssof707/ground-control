import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
	PermissionDecision,
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../shared/schemas/claude_session";

const api = {};

const claude = {
	startSession: (input: StartSessionInput) =>
		ipcRenderer.invoke("session:start", input),
	cancelSession: (sessionId: string) =>
		ipcRenderer.invoke("session:cancel", sessionId),
	sendUserMessage: (turn: UserTurn) =>
		ipcRenderer.invoke("session:userMessage", turn),
	finishSession: (sessionId: string) =>
		ipcRenderer.invoke("session:finish", sessionId),
	interruptSession: (sessionId: string) =>
		ipcRenderer.invoke("session:interrupt", sessionId),
	resumeSession: (sessionId: string) =>
		ipcRenderer.invoke("session:resume", sessionId),
	refreshBranch: (sessionId: string) =>
		ipcRenderer.invoke("session:refreshBranch", sessionId),
	switchBranch: (sessionId: string, branch: string) =>
		ipcRenderer.invoke("session:switchBranch", { sessionId, branch }),
	forkSession: (sessionId: string, messageId: string) =>
		ipcRenderer.invoke("session:fork", { sessionId, messageId }),
	setSessionMode: (sessionId: string, mode: SessionMode) =>
		ipcRenderer.invoke("session:setMode", { sessionId, mode }),
	respondPermission: (decision: PermissionDecision) =>
		ipcRenderer.send("permission:respond", decision),
	listSessions: () => ipcRenderer.invoke("sessions:list"),
	deleteSession: (sessionId: string) =>
		ipcRenderer.invoke("session:delete", sessionId),
	renameSession: (sessionId: string, title: string) =>
		ipcRenderer.invoke("session:rename", { sessionId, title }),
	pickFolder: (opts?: { defaultPath?: string }) =>
		ipcRenderer.invoke("dialog:pickFolder", opts ?? {}),
	setUnreadCount: (count: number) =>
		ipcRenderer.send("notifications:setUnreadCount", count),
	listReadState: () => ipcRenderer.invoke("read:list"),
	markRead: (sessionId: string, ts?: number) =>
		ipcRenderer.invoke("read:mark", { sessionId, ts }),
	listMinimized: () => ipcRenderer.invoke("minimized:list"),
	setMinimized: (sessionId: string, value: boolean) =>
		ipcRenderer.invoke("minimized:set", { sessionId, value }),
	getSettings: () => ipcRenderer.invoke("settings:get"),
	setLastUsedWorkspace: (cwd: string) =>
		ipcRenderer.invoke("settings:setLastUsedWorkspace", { cwd }),
	setSessionsSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setSessionsSidebarWidth", { width }),
	listPermissions: () => ipcRenderer.invoke("permissions:list"),
	getAppInfo: () => ipcRenderer.invoke("appInfo:get"),
	on: (channel: string, fn: (payload: unknown) => void) => {
		const listener = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
		ipcRenderer.on(channel, listener);
		return () => {
			ipcRenderer.removeListener(channel, listener);
		};
	},
};

if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
		contextBridge.exposeInMainWorld("claude", claude);
	} catch (error) {
		console.error(error);
	}
} else {
	// @ts-expect-error global window typing
	window.electron = electronAPI;
	// @ts-expect-error global window typing
	window.api = api;
	// @ts-expect-error global window typing
	window.claude = claude;
}
