import { ipcMain } from "electron";
import * as minimizedStore from "../core/store/minimized_state";
import { broadcast } from "../windows";

export function registerMinimizedHandlers(): void {
	ipcMain.handle("minimized:list", () => minimizedStore.list());
	ipcMain.handle(
		"minimized:set",
		async (e, payload: { sessionId: string; value: boolean }) => {
			await minimizedStore.set(payload.sessionId, payload.value);
			// Skip the originating window — it already updated its local cache
			// optimistically. Other windows refetch via the ping.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
}
