import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { join } from "path";
import { electronApp, is } from "@electron-toolkit/utils";
import type { FastifyInstance } from "fastify";
import { startServer, FASTIFY_PORT } from "./server";
import { flush as flushStore } from "./core/store/write_queue";
import {
	initialize as initializeClaudeSessionStore,
	listSessions,
	deleteSession,
} from "./core/store/claude_session";
import { initialize as initializeReadStore } from "./core/store/read_state";
import { initialize as initializeSessionNotesStore } from "./core/store/session_notes";
import { initialize as initializeWorktreesStore } from "./core/store/worktrees";
import { initialize as initializeSessionGroupsStore } from "./core/store/session_groups";
import { initialize as initializeShortcutsStore } from "./core/store/shortcuts";
import {
	initialize as initializeAppSettingsStore,
	get as getAppSettings,
	setLastUsedWorkspace,
} from "./core/store/app_settings";
import { resolveDataDir } from "./core/store/data_dir";
import { registerSessionsHandlers } from "./ipc/sessionsHandlers";
import { cleanupDuplicateInstalls } from "./updater";
import type { SessionManager } from "./sessions/SessionManager";
import * as windows from "./windows";

let server: FastifyInstance | null = null;
let sessionManager: SessionManager | null = null;
// Single flag governing the shutdown sequence. Set synchronously — either at
// the top of `before-quit` when there's nothing to prompt about, or inside the
// dialog resolution *before* re-issuing `app.quit()`. Anything downstream that
// needs to know "are we tearing down?" (the window `close` handler, re-entered
// `before-quit`) reads this one flag. No async races.
let isQuitting = false;

const preloadPath = join(__dirname, "../preload/index.mjs");

function createWindow(): BrowserWindow {
	// Hard single-window guard. Any accidental caller (menu action, IPC, etc.)
	// gets bounced to the existing window instead of stamping out a second one.
	const existing = windows.getPrimary();
	if (existing) {
		windows.showAndFocusAny();
		return existing;
	}
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		show: false,
		title: "Ground Control",
		webPreferences: {
			preload: preloadPath,
			sandbox: false,
			contextIsolation: true,
		},
	});

	win.on("ready-to-show", () => win.show());

	// Hard rule: NO external URL is ever allowed to render inside this
	// Electron app. Every http(s)/mailto/etc. URL is shoved out to the OS
	// default browser (Chrome on this machine). Two paths to cover:
	//
	//   1. `window.open(...)` / `<a target="_blank">` — would default to a
	//      new chromeless BrowserWindow. Deny, openExternal instead.
	//   2. `<a href>` clicks on the existing webContents — would navigate
	//      away from our app. If the destination is not our own renderer
	//      origin, cancel and openExternal.
	//
	// Same-origin navigation is allowed so React Router + Vite HMR keep
	// working (renderer is http://localhost:* in dev, file:// in prod).
	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		try {
			const target = new URL(url);
			const here = new URL(win.webContents.getURL());
			if (target.origin === here.origin) return;
		} catch {
			// Unparseable URL — block and bounce to the OS to decide.
		}
		event.preventDefault();
		void shell.openExternal(url);
	});

	win.on("close", (event) => {
		// Two cases:
		//   1. `isQuitting` is already true — the quit sequence is committed,
		//      let the window destroy so `will-quit` can fire.
		//   2. Fresh close (red button, Cmd+W) — funnel through `app.quit()`
		//      so the "N sessions active" dialog owns whether we actually
		//      quit. If the user cancels the dialog, we prevented default
		//      here so the window stays open.
		if (isQuitting) return;
		event.preventDefault();
		app.quit();
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
	// Custom app menu so we can insert "Check for Updates…" in the standard
	// macOS location (right below "About"). Otherwise identical to the default
	// `{ role: "appMenu" }` template.
	const appMenu: Electron.MenuItemConstructorOptions = {
		role: "appMenu",
		submenu: [
			{ role: "about" },
			{
				label: "Check for Updates…",
				click: () => {
					// The renderer owns the UX (modal, progress, "you're up to
					// date" toast). Main just pings — the check itself runs via
					// IPC from the renderer so both entry points (menu click,
					// startup check) flow through the same code path.
					windows.broadcast("updater:menu-triggered", {});
				},
			},
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	};
	// Custom View menu (instead of `{ role: "viewMenu" }`) so we can drop plain
	// Reload and free up Cmd+R for the composer-focus/quote-selection hotkey
	// (see useComposerFocusHotkey). Force Reload stays on Shift+Cmd+R.
	const viewMenu: Electron.MenuItemConstructorOptions = {
		label: "View",
		submenu: [
			{ role: "forceReload" },
			{ role: "toggleDevTools" },
			{ type: "separator" },
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	};
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac ? [appMenu] : []),
		{
			label: "File",
			submenu: [isMac ? { role: "close" } : { role: "quit" }],
		},
		{ role: "editMenu" },
		viewMenu,
		{ role: "windowMenu" },
	];
	return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
	electronApp.setAppUserModelId("com.anthropic.ground-control");

	// Hand-rolled replacement for `optimizer.watchWindowShortcuts`: same
	// DevTools handling, but deliberately never touches KeyR. The stock
	// helper's production branch calls `preventDefault()` on any Cmd/Ctrl+R
	// before-input-event, which — unlike a renderer keydown listener — also
	// suppresses the menu accelerator, silently eating Cmd+R in packaged
	// builds. We want that key free for the composer-focus hotkey instead.
	app.on("browser-window-created", (_, window) => {
		window.webContents.on("before-input-event", (event, input) => {
			if (input.type !== "keyDown") return;
			if (!is.dev) {
				if (
					(input.code === "KeyI" && input.alt && input.meta)
					|| (input.code === "KeyI" && input.control && input.shift)
				) {
					event.preventDefault();
				}
			} else if (input.code === "F12") {
				if (window.webContents.isDevToolsOpened()) {
					window.webContents.closeDevTools();
				} else {
					window.webContents.openDevTools({ mode: "undocked" });
				}
			}
		});
	});

	Menu.setApplicationMenu(buildMenu());

	// Silently sweep /Applications/ for stray "Ground Control 2.app" /
	// "Ground Control (1).app" siblings left behind by past botched updates
	// or manual Finder drags. Fire-and-forget on prod only — in dev the
	// running app isn't installed to /Applications and there's no
	// meaningful cleanup to do. Errors are already swallowed inside.
	if (!is.dev) {
		cleanupDuplicateInstalls()
			.then((removed) => {
				if (removed.length > 0) {
					console.log(
						`[ccw] updater: cleaned ${removed.length} duplicate install(s) on startup`,
					);
				}
			})
			.catch((err) => {
				console.warn("[ccw] updater: startup cleanup errored:", err);
			});
	}

	const dataDir = resolveDataDir();
	console.log(`[ccw] store dataDir: ${dataDir} (dev=${is.dev})`);
	try {
		await initializeClaudeSessionStore(dataDir);
		await initializeReadStore(dataDir);
		await initializeAppSettingsStore(dataDir);
		await initializeSessionNotesStore(dataDir);
		await initializeWorktreesStore(dataDir);
		await initializeSessionGroupsStore(dataDir);
		await initializeShortcutsStore(dataDir);
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
		if (windows.getPrimary()) {
			windows.showAndFocusAny();
			return;
		}
		createWindow();
	});
});

// NOTE: this handler is intentionally NOT async. Electron does not await
// event listeners — an `async` handler that `await`s a dialog lets Electron
// continue tearing things down (closing windows, firing subsequent events)
// while the dialog is still open. That's what caused the "Cmd+Q needs two
// tries" bug: `event.preventDefault()` was called synchronously but the flag
// bookkeeping happened after the await, and re-entered events raced past it.
//
// New shape: preventDefault + fire the dialog + resolve via `.then()`. Flip
// `isQuitting` synchronously *before* re-issuing `app.quit()` so the second
// pass of this handler (and the window `close` handler) short-circuit cleanly.
app.on("before-quit", (event) => {
	if (isQuitting) return;

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
	const p = focused
		? dialog.showMessageBox(focused, opts)
		: dialog.showMessageBox(opts);
	p.then((result) => {
		if (result.response !== 1) return; // Cancel — leave everything as-is.
		isQuitting = true; // MUST be set before app.quit() so re-entry sees it.
		sessionManager?.cancelAll();
		app.quit();
	}).catch((err) => {
		console.error("[ccw] quit-confirm dialog errored:", err);
	});
});

// The load-bearing fix. Previously this called `app.quit()` after async
// cleanup, which re-entered the entire quit cycle and could leave the
// process alive (blocking the auto-update swap script's parent-PID wait).
// New shape:
//   1. `server = null` synchronously — makes this handler idempotent so a
//      re-entered `will-quit` is a no-op.
//   2. Await cleanup off the event loop.
//   3. `app.exit(0)` — hard-exits the process. Bypasses will-quit re-entry
//      and terminates regardless of any leaked handles / open sockets that
//      might otherwise keep Node's event loop alive.
app.on("will-quit", (event) => {
	if (server === null) return;
	event.preventDefault();
	const s = server;
	server = null;
	void (async () => {
		try {
			await s.close();
		} catch (err) {
			console.error("[ccw] error closing fastify:", err);
		}
		try {
			await flushStore();
		} catch (err) {
			console.error("[ccw] error flushing store:", err);
		}
		app.exit(0);
	})();
});

app.on("window-all-closed", () => {
	// Single-window app: no windows = quit. Belt-and-suspenders in case the
	// OS destroys the window without our `close` handler running.
	app.quit();
});
