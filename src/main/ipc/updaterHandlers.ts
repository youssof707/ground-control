import { ipcMain } from "electron";
import { checkForUpdate, downloadAndInstall } from "../updater";

export function registerUpdaterHandlers(): void {
	ipcMain.handle("updater:check", async () => {
		return checkForUpdate();
	});

	// Fire-and-forget: the renderer subscribes to `updater:status` /
	// `updater:progress` events for the live install flow, and the app will
	// quit itself when the swap script is scheduled. So this returns void.
	ipcMain.handle("updater:install", async (_e, downloadUrl: string) => {
		await downloadAndInstall(downloadUrl);
	});
}
