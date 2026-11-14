import { app, ipcMain } from "electron";
import {
	deleteTerminalConfig,
	getTerminalConfig,
	listTerminalConfigs,
	saveTerminalConfig,
} from "../core/store/terminal_configs";
import {
	loadSavedTerminals,
	saveTerminalsSync,
} from "../core/store/saved_terminals";
import { TerminalManager } from "../terminals/TerminalManager";
import { broadcast } from "../windows";

export function registerTerminalsHandlers(): void {
	const manager = new TerminalManager({
		data: (event) => broadcast("terminals:data", event),
		changed: (terminals) => broadcast("terminals:changed", terminals),
	});

	ipcMain.handle("terminals:list", () => manager.list());
	ipcMain.handle("terminals:create", (_e, cwd: unknown, splitFrom: unknown) =>
		manager.create(
			typeof cwd === "string" ? cwd : undefined,
			typeof splitFrom === "string" ? splitFrom : undefined,
		),
	);
	ipcMain.handle("terminals:snapshot", (_e, id: string) =>
		manager.snapshot(id),
	);
	ipcMain.handle("terminals:kill", (_e, id: string) => manager.kill(id));
	ipcMain.handle("terminals:killGroup", (_e, groupId: string) =>
		manager.killGroup(groupId),
	);
	ipcMain.handle("terminals:stop", (_e, id: string) => manager.stop(id));
	ipcMain.handle("terminals:rerun", (_e, id: string) => manager.rerun(id));
	ipcMain.handle("terminals:stopGroup", (_e, groupId: string) =>
		manager.stopGroup(groupId),
	);
	ipcMain.handle("terminals:rerunGroup", (_e, groupId: string) =>
		manager.rerunGroup(groupId),
	);
	ipcMain.handle("terminals:renameGroup", (_e, groupId: string, name: unknown) => {
		if (typeof name === "string") manager.renameGroup(groupId, name);
	});
	ipcMain.handle("terminals:listConfigs", () => listTerminalConfigs());
	ipcMain.handle(
		"terminals:saveConfig",
		async (_e, groupId: string, name: unknown) => {
			const config = manager.describeGroup(groupId);
			if (!config) return null;
			const chosen = typeof name === "string" ? name.trim().slice(0, 80) : "";
			return saveTerminalConfig({ ...config, name: chosen || config.name });
		},
	);
	ipcMain.handle(
		"terminals:loadConfig",
		async (_e, configId: string, groupId: unknown) => {
			const config = await getTerminalConfig(configId);
			if (!config) return null;
			return manager.replaceGroup(
				typeof groupId === "string" ? groupId : null,
				config,
			);
		},
	);
	ipcMain.handle("terminals:deleteConfig", (_e, configId: string) =>
		deleteTerminalConfig(configId),
	);
	ipcMain.on("terminals:write", (_e, id: string, data: string) => {
		if (typeof data === "string") manager.write(id, data);
	});
	ipcMain.on("terminals:resize", (_e, id: string, cols: number, rows: number) =>
		manager.resize(id, cols, rows),
	);

	let restored = false;
	void loadSavedTerminals()
		.then((groups) => manager.restore(groups))
		.catch((err: unknown) => {
			console.error("[terminals] restore failed:", err);
		})
		.finally(() => {
			restored = true;
		});

	app.on("will-quit", () => {
		if (restored) {
			try {
				saveTerminalsSync(manager.describeAll());
			} catch (err) {
				console.error("[terminals] save failed:", err);
			}
		}
		manager.disposeAll();
	});
}
