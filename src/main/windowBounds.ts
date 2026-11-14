import { screen, type BrowserWindow, type Rectangle } from "electron";
import {
	get as getWindowState,
	save as saveWindowState,
	type WindowState,
} from "./core/store/window_state";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;
const SAVE_DEBOUNCE_MS = 500;

export type InitialBounds = {
	bounds: Partial<Rectangle> & { width: number; height: number };
	isMaximized: boolean;
	isFullScreen: boolean;
};

function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
	return {
		width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
		height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
	};
}

function fitToVisibleDisplay(saved: WindowState): Rectangle | null {
	const rect: Rectangle = {
		x: saved.x,
		y: saved.y,
		width: saved.width,
		height: saved.height,
	};
	const area = screen
		.getAllDisplays()
		.map((d) => d.workArea)
		.find((workArea) => {
			const o = overlap(rect, workArea);
			return o.width >= MIN_VISIBLE_WIDTH && o.height >= MIN_VISIBLE_HEIGHT;
		});
	if (!area) return null;
	const width = Math.min(rect.width, area.width);
	const height = Math.min(rect.height, area.height);
	const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
	const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
	return { x, y, width, height };
}

export function initialBounds(): InitialBounds {
	const saved = getWindowState();
	const fallback: InitialBounds = {
		bounds: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
		isMaximized: false,
		isFullScreen: false,
	};
	if (!saved) return fallback;
	const fitted = fitToVisibleDisplay(saved);
	if (!fitted) return fallback;
	return {
		bounds: fitted,
		isMaximized: saved.isMaximized,
		isFullScreen: saved.isFullScreen,
	};
}

function snapshot(win: BrowserWindow): WindowState {
	const bounds = win.getNormalBounds();
	return {
		...bounds,
		isMaximized: win.isMaximized(),
		isFullScreen: win.isFullScreen(),
	};
}

export function trackWindowBounds(win: BrowserWindow): void {
	let timer: NodeJS.Timeout | null = null;

	const saveNow = (): void => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (win.isDestroyed() || win.isMinimized()) return;
		saveWindowState(snapshot(win)).catch((err) => {
			console.error("[window-state] failed to save window bounds:", err);
		});
	};

	const scheduleSave = (): void => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
	};

	win.on("resize", scheduleSave);
	win.on("move", scheduleSave);
	win.on("maximize", scheduleSave);
	win.on("unmaximize", scheduleSave);
	win.on("enter-full-screen", scheduleSave);
	win.on("leave-full-screen", scheduleSave);
	win.on("close", saveNow);
	win.on("closed", () => {
		if (timer) clearTimeout(timer);
		timer = null;
	});
}
