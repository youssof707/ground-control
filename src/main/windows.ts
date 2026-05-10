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

export function broadcast(channel: string, payload: unknown): void {
	for (const win of getAll()) {
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
