import { ipcMain } from "electron";
import * as appSettings from "../core/store/app_settings";
import { broadcast } from "../windows";

export function registerSettingsHandlers(): void {
	ipcMain.handle("settings:get", () => appSettings.get());
	ipcMain.handle(
		"settings:setLastUsedWorkspace",
		async (e, payload: { cwd: string }) => {
			await appSettings.setLastUsedWorkspace(payload.cwd);
			// Skip the originating window — it already updated its local cache
			// optimistically. Other windows refetch via the ping.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
}
