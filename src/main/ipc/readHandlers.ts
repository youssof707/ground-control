import { ipcMain } from "electron";
import * as readStore from "../core/store/read_state";
import { broadcast } from "../windows";

export function registerReadHandlers(): void {
	ipcMain.handle("read:list", () => readStore.list());
	ipcMain.handle(
		"read:mark",
		async (e, payload: { sessionId: string; ts?: number }) => {
			await readStore.mark(payload.sessionId, payload.ts);
			// Skip the originating window — it already updated its local cache
			// optimistically. Other windows refetch via the ping.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	ipcMain.handle(
		"read:markUnread",
		async (e, payload: { sessionId: string }) => {
			await readStore.unmark(payload.sessionId);
			// Same skip-self broadcast as read:mark — origin window already
			// updated its local cache optimistically.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
}
