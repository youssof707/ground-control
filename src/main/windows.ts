import { BrowserWindow } from "electron";

const windows = new Set<BrowserWindow>();
let lastFocused: BrowserWindow | null = null;

export function register(win: BrowserWindow): void {
	windows.add(win);
	lastFocused = win;
	win.on("focus", () => {
		lastFocused = win;
	});
	win.on("closed", () => {
		windows.delete(win);
		if (lastFocused === win) lastFocused = null;
	});
}

export function getAll(): BrowserWindow[] {
	const live: BrowserWindow[] = [];
	for (const w of windows) if (!w.isDestroyed()) live.push(w);
	return live;
}

export function count(): number {
	return getAll().length;
}

export function getPrimary(): BrowserWindow | null {
	if (lastFocused && !lastFocused.isDestroyed()) return lastFocused;
	return getAll()[0] ?? null;
}

/**
 * Send `channel` + `payload` to every live window. If `exceptWebContentsId` is
 * provided, the matching window is skipped — used by the multi-window
 * `state:changed` ping so the originating window doesn't refetch what it
 * already knows from its own IPC response.
 */
export function broadcast(
	channel: string,
	payload: unknown,
	exceptWebContentsId?: number,
): void {
	for (const win of getAll()) {
		if (
			exceptWebContentsId !== undefined &&
			win.webContents.id === exceptWebContentsId
		) {
			continue;
		}
		win.webContents.send(channel, payload);
	}
}

export function showAndFocusAny(): BrowserWindow | null {
	const win = getPrimary();
	if (!win) return null;
	if (win.isMinimized()) win.restore();
	if (!win.isVisible()) win.show();
	win.focus();
	return win;
}
