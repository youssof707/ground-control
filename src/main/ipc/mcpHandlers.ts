import { app, ipcMain } from "electron";
import { McpProbePool } from "../mcp/McpProbePool";
import type { SessionManager } from "../sessions/SessionManager";
import { broadcast } from "../windows";

export function registerMcpHandlers(manager: SessionManager): void {
	const pool = new McpProbePool(
		(cwd) => manager.liveQueriesIn(cwd),
		(event) => broadcast("mcp:changed", event),
	);

	ipcMain.handle("mcp:status", (_e, payload: { cwd: string }) =>
		pool.status(payload.cwd),
	);
	ipcMain.handle(
		"mcp:reconnect",
		(_e, payload: { cwd: string; name: string }) =>
			pool.reconnect(payload.cwd, payload.name),
	);
	ipcMain.handle(
		"mcp:toggle",
		(_e, payload: { cwd: string; name: string; enabled: boolean }) =>
			pool.toggle(payload.cwd, payload.name, payload.enabled),
	);
	ipcMain.handle(
		"mcp:authenticate",
		(_e, payload: { cwd: string; name: string }) =>
			pool.authenticate(payload.cwd, payload.name),
	);
	ipcMain.handle("mcp:release", (_e, payload: { cwd: string }) =>
		pool.release(payload.cwd),
	);

	app.on("will-quit", () => pool.disposeAll());
}
