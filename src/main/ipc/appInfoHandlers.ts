import { ipcMain } from "electron";
import { is } from "@electron-toolkit/utils";
import path from "node:path";
import { resolveDataDir } from "../core/store/data_dir";

export function registerAppInfoHandlers(): void {
	ipcMain.handle("appInfo:get", () => {
		return {
			env: is.dev ? "dev" : "prod",
			storeFolder: path.basename(resolveDataDir()),
		};
	});
}
