import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { SessionManager } from "../sessions/SessionManager";
import { PermissionBroker } from "../sessions/PermissionBroker";
import { NotificationManager } from "./notifications";
import type {
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../../shared/schemas/claude_session";
import * as sessionStore from "../core/store/claude_session";
import * as notesStore from "../core/store/session_notes";
import * as readStore from "../core/store/read_state";
import * as worktreesStore from "../core/store/worktrees";
import * as groupsStore from "../core/store/session_groups";
import { broadcast } from "../windows";
import { registerReadHandlers } from "./readHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerAppInfoHandlers } from "./appInfoHandlers";
import { registerNotesHandlers } from "./notesHandlers";
import { registerRateLimitHandlers } from "./rateLimitHandlers";
import { registerWorktreesHandlers } from "./worktreesHandlers";
import {
	registerGroupsHandlers,
	pruneGroupIfEmpty,
} from "./groupsHandlers";
import { registerShortcutsHandlers } from "./shortcutsHandlers";
import { registerSkillsHandlers } from "./skillsHandlers";
import { registerUpdaterHandlers } from "./updaterHandlers";
import { registerDictationHandlers } from "./dictationHandlers";
import { registerImageHandlers } from "./imageHandlers";

/**
 * Open the native macOS "choose a directory" dialog. Returns the absolute
 * path the user picked, or null if they cancelled / closed the sheet.
 *
 * Modal-parents itself to `win` when one is provided so the dialog is a
 * sheet on macOS rather than a free-floating window. `defaultPath` is the
 * folder the picker opens into (e.g. the parent of a missing cwd).
 */
async function showFolderPicker(
	win: BrowserWindow | null,
	defaultPath?: string,
): Promise<string | null> {
	const options: Electron.OpenDialogOptions = {
		properties: ["openDirectory", "createDirectory"],
		defaultPath,
	};
	const result = win
		? await dialog.showOpenDialog(win, options)
		: await dialog.showOpenDialog(options);
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
}

/**
 * Best-effort directory-existence check. Returns false on any stat failure
 * (missing path, permission error, broken symlink) and also for paths that
 * exist but aren't directories (e.g. a stale entry that now points at a
 * file). Callers treat false as "ask the user to pick a real folder".
 */
async function directoryExists(path: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

export function registerSessionsHandlers(): SessionManager {
	const notifications = new NotificationManager();
	let manager: SessionManager;
	const broker = new PermissionBroker(
		notifications,
		(sessionId) => manager?.getSession(sessionId)?.title,
		// Re-anchor the branch baseline when the user answers a permission /
		// plan / ask-user prompt. Same hook as sending a message.
		(sessionId) => manager?.snapshotBranchCheckpoint(sessionId),
	);
	manager = new SessionManager(broker);

	registerReadHandlers();
	registerSettingsHandlers();
	registerAppInfoHandlers();
	registerNotesHandlers();
	registerRateLimitHandlers();
	registerWorktreesHandlers();
	registerGroupsHandlers();
	registerShortcutsHandlers();
	registerSkillsHandlers();
	registerUpdaterHandlers();
	registerDictationHandlers();
	registerImageHandlers();

	ipcMain.handle("session:start", async (e, input: StartSessionInput) => {
		// Guard against stale `cwd` values (e.g. a `lastUsedWorkspace` whose
		// folder has been moved or deleted between app launches). Without
		// this check the session is created with a bogus path and the SDK
		// only errors out much later on its first tool call — by which point
		// there's no obvious recovery affordance in the UI.
		let cwd = input.cwd;
		if (!(await directoryExists(cwd))) {
			const win = BrowserWindow.fromWebContents(e.sender);
			// Open the picker at the parent of the missing path so the user
			// lands close to where they expected the folder to live.
			const picked = await showFolderPicker(win, dirname(cwd));
			if (!picked) {
				throw new Error(
					`Folder "${cwd}" no longer exists and no replacement was selected.`,
				);
			}
			cwd = picked;
		}
		// Guard against a stale worktree reference (e.g. deleted between
		// draft attach and first send, or a mismatched baseDir). Reject
		// early so we don't create a session with a dangling pointer.
		let worktreeId = input.worktreeId;
		if (worktreeId) {
			const wt = worktreesStore.get(worktreeId);
			if (!wt) {
				throw new Error(
					"The selected worktree no longer exists. Reopen the draft and pick another.",
				);
			}
			if (wt.baseDir !== cwd) {
				// The user changed folders after attach and somehow got
				// through; clear the binding rather than silently running
				// against a wrong-repo checkout.
				worktreeId = undefined;
			}
		}
		// Guard against a stale group reference (e.g. the group auto-deleted
		// via pruneGroupIfEmpty between a handoff draft capturing its id and
		// this send). Soft-drop rather than throw — an auto-pruned group
		// shouldn't block session creation, it should just leave the new
		// session ungrouped, mirroring the worktree baseDir-mismatch branch
		// above.
		let groupId = input.groupId;
		if (groupId && !groupsStore.get(groupId)) {
			groupId = undefined;
		}
		return manager.run({ ...input, cwd, worktreeId, groupId });
	});
	ipcMain.handle("session:cancel", (_e, sessionId: string) => {
		manager.cancel(sessionId);
	});
	ipcMain.handle("session:userMessage", (_e, turn: UserTurn) => {
		manager.pushUserMessage(turn.sessionId, turn.blocks);
	});
	ipcMain.handle("session:finish", (_e, sessionId: string) => {
		manager.finish(sessionId);
	});
	ipcMain.handle("session:interrupt", (_e, sessionId: string) =>
		manager.interrupt(sessionId),
	);
	ipcMain.handle("session:resume", (_e, sessionId: string) =>
		manager.resume(sessionId),
	);
	ipcMain.handle("session:refreshBranch", (_e, sessionId: string) =>
		manager.refreshBranch(sessionId),
	);
	ipcMain.handle(
		"session:switchBranch",
		(_e, payload: { sessionId: string; branch: string }) =>
			manager.switchBranchInSession(payload.sessionId, payload.branch),
	);
	ipcMain.handle("session:hasUncommittedChanges", (_e, sessionId: string) =>
		manager.hasUncommittedChangesInSession(sessionId),
	);
	ipcMain.handle(
		"session:fork",
		async (e, payload: { sessionId: string; messageId: string }) => {
			const newSession = await manager.fork(
				payload.sessionId,
				payload.messageId,
			);
			// Structural ping → other windows refetch and see the new session
			// in their lists. Originator already received it via session:started.
			broadcast("state:changed", undefined, e.sender.id);
			return newSession;
		},
	);
	// Promote a sidequest into a real session (the panel's Fork action). Unlike
	// the rest of the sidequest surface this DOES mint a store row, so it pings
	// `state:changed` exactly like `session:fork`.
	ipcMain.handle(
		"sidequest:promote",
		async (e, payload: { parentSessionId: string; messageId: string }) => {
			const newSession = await manager.promoteSidequest(
				payload.parentSessionId,
				payload.messageId,
			);
			broadcast("state:changed", undefined, e.sender.id);
			return newSession;
		},
	);
	// Starting and discarding, by contrast, write nothing to the session store,
	// so there is no `state:changed` ping and nothing for other windows to
	// refetch. The `sidequest:*` broadcasts carry the whole story.
	ipcMain.handle(
		"sidequest:start",
		(
			_e,
			payload: {
				sidequestId: string;
				parentSessionId: string;
				forkMessageId: string;
			},
		) => manager.startSidequest(payload),
	);
	ipcMain.handle("sidequest:discard", (_e, parentSessionId: string) =>
		manager.discardSidequest(parentSessionId),
	);
	ipcMain.handle(
		"session:setMode",
		async (e, payload: { sessionId: string; mode: SessionMode }) => {
			await manager.setMode(payload.sessionId, payload.mode);
			// Skip the originator — its UI updated from the IPC response and from
			// the existing `session:patch` broadcast SessionManager fires.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	ipcMain.handle(
		"session:setModel",
		async (e, payload: { sessionId: string; model?: string }) => {
			await manager.setModel(payload.sessionId, payload.model);
			// Skip the originator — its UI updated from the IPC response and from
			// the existing `session:patch` broadcast SessionManager fires.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	// Returns the CLI's live model list. Uses the session's live query when
	// one exists, otherwise spawns a transient probe query against the same
	// binary that would run the real session — so the picker never shows a
	// model the binary can't actually spawn. Rejects on error; the renderer
	// surfaces the message in the picker's error slot.
	ipcMain.handle("session:supportedModels", (_e, sessionId: string) =>
		manager.supportedModels(sessionId),
	);
	ipcMain.handle("sessions:list", () => sessionStore.listSessions());
	ipcMain.handle("permissions:list", () => broker.listPending());
	ipcMain.on("notifications:setUnreadCount", (_e, count: number) => {
		notifications.setUnreadCount(typeof count === "number" ? count : 0);
	});
	ipcMain.handle(
		"dialog:pickFolder",
		async (
			e,
			opts: { defaultPath?: string } = {},
		): Promise<string | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			return showFolderPicker(win, opts.defaultPath);
		},
	);
	ipcMain.handle("shell:revealPath", async (_e, path: string) => {
		if (typeof path !== "string" || !path) return;
		shell.showItemInFolder(path);
	});
	ipcMain.handle(
		"session:rename",
		async (e, payload: { sessionId: string; title: string }) => {
			const title = payload.title.trim().slice(0, 200);
			if (!title) throw new Error("Title cannot be empty");
			const updated = await sessionStore.updateSession(payload.sessionId, {
				title,
				// An explicit rename is by definition a user-chosen name, so
				// lock it. Without this, renaming a session that hasn't sent
				// its first message yet gets silently clobbered when that
				// message arrives and SessionManager derives a title from it.
				titleLocked: true,
			});
			if (!updated) throw new Error("Session not found");
			// Keep the live runtime copy in sync (notification subtitles read
			// from it); no-op when the session isn't currently running.
			manager.setTitle(payload.sessionId, title);
			// Existing incremental event so other windows update title without a
			// full refetch.
			broadcast("session:patch", {
				sessionId: payload.sessionId,
				title,
				titleLocked: true,
			});
			// Safety-net structural ping for any window that might have missed
			// the patch (e.g. attached its listener after the patch fired).
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
	ipcMain.handle("session:archive", async (e, sessionId: string) => {
		// Archive is "set aside, but reversible". The session record stays
		// fully intact (no tombstone, no notes deletion), but every UI
		// affordance that demands attention is quieted:
		//   1. Stop the SDK loop so it stops emitting messages / status
		//      updates that would push the row back to "unread" or
		//      "running" after archive.
		//   2. Reject any in-flight permission / tool-use / ask-user prompts
		//      so the user isn't blocked on something they've stashed away.
		//      `cancelAllForSession` broadcasts `permission:resolved` for
		//      each cancellation, which drains the renderer's permissions
		//      queue (and therefore the Inbox badge + waiting count).
		//   3. Mark read at `now()` so the session stops contributing to
		//      the unread count / dock badge. Monotonic in the store, so
		//      this is a no-op if the session is already up-to-date.
		manager.cancel(sessionId);
		broker.cancelAllForSession(sessionId, "Session archived");
		// A sidequest outlives nothing — its parent is being set aside, so
		// stop it too rather than leave an orphan SDK loop running.
		void manager.discardSidequest(sessionId);
		await readStore.mark(sessionId);
		// Archiving intentionally KEEPS the session's group membership —
		// the row returns to its group on unarchive / "Show archived
		// sessions". Archived members still count for the auto-delete
		// check, so a group whose members are all archived survives (it's
		// merely hidden, because the sidebar derives group sections from
		// visible rows only). Only remove-from-group and session delete
		// can empty a group.
		const archivedAt = Date.now();
		const updated = await sessionStore.updateSession(sessionId, {
			archivedAt,
		});
		if (!updated) throw new Error("Session not found");
		// Incremental patch so other windows hide the row without a full
		// refetch. The existing renderer-side `session:patch` listener routes
		// this through `upsertSession`, which merges `archivedAt` into the
		// store; the sidebar's `visibleOrder` filter then drops the row.
		broadcast("session:patch", { sessionId, archivedAt });
		// Safety-net structural ping for any window that might have missed
		// the patch — also picks up the new read-state row on other windows.
		broadcast("state:changed", undefined, e.sender.id);
	});
	ipcMain.handle("session:unarchive", async (e, sessionId: string) => {
		// Reverse of archive: clear the timestamp. Intentionally does NOT
		// undo the cancel / mark-read side effects — restarting the SDK
		// loop or rolling back read state is the user's call.
		const updated = await sessionStore.updateSession(sessionId, {
			archivedAt: undefined,
		});
		if (!updated) throw new Error("Session not found");
		broadcast("session:patch", { sessionId, archivedAt: undefined });
		broadcast("state:changed", undefined, e.sender.id);
	});
	ipcMain.handle("session:delete", async (e, sessionId: string) => {
		// Capture the worktree binding BEFORE we tombstone / delete the
		// session record — we need it to detach from the worktree registry
		// afterwards so the "no delete while attached" invariant holds.
		const preDeleteSession = sessionStore.getSession(sessionId);
		const worktreeIdToDetach = preDeleteSession?.worktreeId;
		// Same capture for the sidebar group — after deleteSession runs the
		// record is gone, and we still need to auto-delete the group if this
		// was its last member.
		const groupIdToPrune = preDeleteSession?.groupId;
		// Tombstone first — synchronous. Any subsequent SDK event for this
		// session id is dropped by SessionManager.send, so leaked status /
		// cancelled / message / patch broadcasts from the still-winding-down
		// loop can't reach any window and lazy-resurrect the row via
		// upsertSession.
		manager.markDeleted(sessionId);
		// Kill any sidequest forked off this session — its fork point is about
		// to stop existing.
		void manager.discardSidequest(sessionId);
		// Trip the abort signal so the SDK loop breaks out on its next tick.
		// We don't await its `done` here: the tombstone above means we don't
		// need its broadcasts anyway.
		manager.cancel(sessionId);
		// Resolve any pending permission promises for this session and broadcast
		// permission:resolved so the renderer's inbox queue clears. Redundant
		// for sessions that were running (the loop's cancelled branch already
		// called this), but the safety net for non-running sessions.
		broker.cancelAllForSession(sessionId, "Session deleted");
		// Persist the deletes. The store-level tombstone in deleteSession()
		// is set synchronously, so any appendMessage / updateSession tasks
		// from the SDK loop that were already queued ahead of these on the
		// shared write_queue short-circuit (Set check, no file write) and
		// drain quickly instead of forcing a full-file flush per message.
		await sessionStore.deleteSession(sessionId);
		// Cascade-delete any notes attached to this session. Awaited before
		// broadcasting so other windows don't briefly see notes attached to a
		// missing session during a refetch.
		await notesStore.deleteAllForSession(sessionId);
		// Detach from the worktree registry so future deletes of the
		// worktree itself can succeed. Best-effort — a missing worktree
		// (externally deleted) is a no-op.
		if (worktreeIdToDetach) {
			try {
				await worktreesStore.detachSession(worktreeIdToDetach, sessionId);
			} catch (err) {
				console.error("[ccw] worktree detachSession failed:", err);
			}
		}
		// Auto-delete the session's group if it just lost its last member.
		// Best-effort, same rationale as the worktree detach above.
		if (groupIdToPrune) {
			try {
				await pruneGroupIfEmpty(groupIdToPrune);
			} catch (err) {
				console.error("[ccw] group pruneGroupIfEmpty failed:", err);
			}
		}
		// Structural ping → other windows refetch and drop this session from
		// their stores. Originator already removed it locally.
		broadcast("state:changed", undefined, e.sender.id);
		// Graceful SDK loop drain in the background. This is what used to
		// block the IPC critical path; now the renderer doesn't wait on it.
		// The tombstone in SessionManager.send filters any of its emitted
		// events; the store-level tombstone no-ops any of its writes.
		void manager.cancelAndWait(sessionId).catch((err) => {
			console.error("[ccw] background cancelAndWait failed:", err);
		});
	});

	return manager;
}
