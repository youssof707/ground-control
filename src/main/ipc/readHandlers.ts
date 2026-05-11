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
}
