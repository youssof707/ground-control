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

	// Hidden affordance: double-click the version indicator in the renderer to
	// toggle DevTools. Works in production builds too — Electron exposes
	// openDevTools regardless of NODE_ENV. Using event.sender (not
	// getFocusedWindow) so the toggle targets the window that issued it.
	ipcMain.handle("devtools:toggle", (event) => {
		const wc = event.sender;
		if (wc.isDevToolsOpened()) {
			wc.closeDevTools();
		} else {
			wc.openDevTools({ mode: "detach" });
		}
	});
}
