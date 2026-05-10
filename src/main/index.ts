import { app, BrowserWindow } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { FastifyInstance } from "fastify";
import { startServer, FASTIFY_PORT } from "./server";
import { flush as flushStore } from "./core/store/write_queue";
import { registerSessionsHandlers } from "./ipc/sessionsHandlers";

let mainWindow: BrowserWindow | null = null;
let server: FastifyInstance | null = null;
let isQuitting = false;

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
		// Initialize per-model stores here as you add them:
		// await initializeFooStore(dataDir);
		void dataDir;
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

	registerSessionsHandlers(() => mainWindow);

	console.log("[ccw] ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);

	app.on("activate", () => {
		if (mainWindow) {
			mainWindow.show();
		} else if (BrowserWindow.getAllWindows().length === 0) {
			mainWindow = createMainWindow();
		}
	});
});

app.on("before-quit", () => {
	isQuitting = true;
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
