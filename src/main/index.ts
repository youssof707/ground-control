import { app, BrowserWindow, dialog } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { FastifyInstance } from "fastify";
import { startServer, FASTIFY_PORT } from "./server";
import { flush as flushStore } from "./core/store/write_queue";
import { initialize as initializeClaudeSessionStore } from "./core/store/claude_session";
import { registerSessionsHandlers } from "./ipc/sessionsHandlers";
import type { SessionManager } from "./sessions/SessionManager";

let mainWindow: BrowserWindow | null = null;
let server: FastifyInstance | null = null;
let sessionManager: SessionManager | null = null;
let isQuitting = false;
let confirmedQuit = false;

const preloadPath = join(__dirname, "../preload/index.mjs");

function createMainWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		show: false,
		title: "Claude Code Wrapper",
		webPreferences: {
			preload: preloadPath,
			sandbox: false,
			contextIsolation: true,
		},
	});

	win.on("ready-to-show", () => win.show());

	win.on("close", (event) => {
		if (!isQuitting) {
			event.preventDefault();
			win.hide();
		}
	});

	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		win.loadFile(join(__dirname, "../renderer/index.html"));
	}

	return win;
}

app.whenReady().then(async () => {
	electronApp.setAppUserModelId("com.anthropic.claude-code-wrapper");

	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window);
	});

	const dataDir = join(app.getPath("userData"), "data");
	try {
		await initializeClaudeSessionStore(dataDir);
	} catch (err) {
		console.error(`[ccw] failed to initialize store at ${dataDir}:`, err);
		app.exit(1);
		return;
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

	mainWindow = createMainWindow();

	sessionManager = registerSessionsHandlers(() => mainWindow);

	console.log("[ccw] ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);

	app.on("activate", () => {
		if (mainWindow) {
			mainWindow.show();
		} else if (BrowserWindow.getAllWindows().length === 0) {
			mainWindow = createMainWindow();
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
	const result = mainWindow
		? await dialog.showMessageBox(mainWindow, opts)
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
