import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
	PermissionDecision,
	StartSessionInput,
} from "../shared/claude-sessions/types";

const api = {};

const claude = {
	startSession: (input: StartSessionInput) =>
		ipcRenderer.invoke("session:start", input),
	cancelSession: (sessionId: string) =>
		ipcRenderer.invoke("session:cancel", sessionId),
	respondPermission: (decision: PermissionDecision) =>
		ipcRenderer.send("permission:respond", decision),
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
