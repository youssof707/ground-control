import { app, BrowserWindow, dialog, Menu } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { FastifyInstance } from "fastify";
import { startServer, FASTIFY_PORT } from "./server";
import { flush as flushStore } from "./core/store/write_queue";
import {
	initialize as initializeClaudeSessionStore,
	listSessions,
	deleteSession,
} from "./core/store/claude_session";
import { initialize as initializeReadStore } from "./core/store/read_state";
import { initialize as initializeMinimizedStore } from "./core/store/minimized_state";
import {
	initialize as initializeAppSettingsStore,
	get as getAppSettings,
	setLastUsedWorkspace,
} from "./core/store/app_settings";
import { resolveDataDir } from "./core/store/data_dir";
import { registerSessionsHandlers } from "./ipc/sessionsHandlers";
import type { SessionManager } from "./sessions/SessionManager";
import * as windows from "./windows";

let server: FastifyInstance | null = null;
let sessionManager: SessionManager | null = null;
let isQuitting = false;
let confirmedQuit = false;

const preloadPath = join(__dirname, "../preload/index.mjs");

function createWindow(): BrowserWindow {
	const offset = windows.count() * 24;
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		x: offset > 0 ? offset : undefined,
		y: offset > 0 ? offset : undefined,
		show: false,
		title: "Ground Control",
		webPreferences: {
			preload: preloadPath,
			sandbox: false,
			contextIsolation: true,
		},
	});

	win.on("ready-to-show", () => win.show());

	win.on("close", (event) => {
		if (isQuitting) return;
		// Keep the app alive when the last window is closed by hiding instead
		// of destroying — so the dock icon can re-show it on macOS. Other
		// windows close normally.
		if (windows.count() > 1) return;
		event.preventDefault();
		win.hide();
	});

	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		win.loadFile(join(__dirname, "../renderer/index.html"));
	}

	windows.register(win);
	return win;
}

function buildMenu(): Electron.Menu {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac
			? ([{ role: "appMenu" }] as Electron.MenuItemConstructorOptions[])
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "New Window",
					accelerator: "CommandOrControl+N",
					click: () => {
						createWindow();
					},
				},
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	];
	return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
	electronApp.setAppUserModelId("com.anthropic.ground-control");

	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window);
	});

	Menu.setApplicationMenu(buildMenu());

	const dataDir = resolveDataDir();
	console.log(`[ccw] store dataDir: ${dataDir} (dev=${is.dev})`);
	try {
		await initializeClaudeSessionStore(dataDir);
		await initializeReadStore(dataDir);
		await initializeMinimizedStore(dataDir);
		await initializeAppSettingsStore(dataDir);
	} catch (err) {
		console.error(`[ccw] failed to initialize store at ${dataDir}:`, err);
		app.exit(1);
		return;
	}

	for (const s of listSessions()) {
		if (s.messages.length === 0) {
			await deleteSession(s.id);
		}
	}

	// One-time backfill: if a user is upgrading from a build that didn't have
	// app_settings, seed `lastUsedWorkspace` from the most recent session's cwd
	// so the New Session button keeps working without forcing a folder pick.
	if (!getAppSettings().lastUsedWorkspace) {
		const sessions = listSessions();
		const mostRecent = sessions
			.filter((s) => !!s.cwd)
			.sort((a, b) => b.createdAt - a.createdAt)[0];
		if (mostRecent?.cwd) {
			try {
				await setLastUsedWorkspace(mostRecent.cwd);
			} catch (err) {
				console.error("[ccw] failed to backfill lastUsedWorkspace:", err);
			}
		}
	}

	try {
		server = await startServer();
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EADDRINUSE") {
			console.error(`[ccw] Port ${FASTIFY_PORT} already in use — exiting`);
		} else {
			console.error("[ccw] failed to start fastify server:", err);
		}
		app.exit(1);
		return;
	}

	sessionManager = registerSessionsHandlers();

	createWindow();

	console.log("[ccw] ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
	const { Notification } = await import("electron");
	console.log(
		"[ccw] Notification.isSupported():",
		Notification.isSupported(),
	);

	app.on("activate", () => {
		const existing = windows.getPrimary();
		if (existing) {
			windows.showAndFocusAny();
		} else if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("before-quit", async (event) => {
	if (confirmedQuit) {
		isQuitting = true;
		return;
	}

	const active = sessionManager?.activeCount ?? 0;
	if (active === 0) {
		isQuitting = true;
		return;
	}

	event.preventDefault();

	const opts: Electron.MessageBoxOptions = {
		type: "warning",
		title: "Quit with active sessions?",
		message: `${active} session${active === 1 ? " is" : "s are"} still active.`,
		detail:
			"Quitting now will cancel them. Their conversation history is saved and you can review them after restart.",
		buttons: ["Cancel", "Quit anyway"],
		defaultId: 0,
		cancelId: 0,
	};
	const focused = windows.getPrimary();
	const result = focused
		? await dialog.showMessageBox(focused, opts)
		: await dialog.showMessageBox(opts);

	if (result.response === 1) {
		confirmedQuit = true;
		sessionManager?.cancelAll();
		app.quit();
	}
});

app.on("will-quit", async (event) => {
	if (server) {
		event.preventDefault();
		try {
			await server.close();
		} catch (err) {
			console.error("[ccw] error closing fastify:", err);
		}
		server = null;
		try {
			await flushStore();
		} catch (err) {
			console.error("[ccw] error flushing store:", err);
		}
		app.quit();
	}
});

app.on("window-all-closed", () => {
	// No-op on macOS — keep app alive so dock icon click can reopen the window.
});
