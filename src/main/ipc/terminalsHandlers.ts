import { app, ipcMain } from "electron";
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
	ipcMain.handle("terminals:renameGroup", (_e, groupId: string, name: unknown) => {
		if (typeof name === "string") manager.renameGroup(groupId, name);
	});
	ipcMain.on("terminals:write", (_e, id: string, data: string) => {
		if (typeof data === "string") manager.write(id, data);
	});
	ipcMain.on("terminals:resize", (_e, id: string, cols: number, rows: number) =>
		manager.resize(id, cols, rows),
	);

	app.on("will-quit", () => manager.disposeAll());
}
