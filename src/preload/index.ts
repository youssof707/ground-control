import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
	PermissionDecision,
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../shared/schemas/claude_session";
import type { CreateWorktreeInput } from "../shared/schemas/worktrees";
import type { CreateSessionGroupInput } from "../shared/schemas/session_groups";
import type {
	CreateShortcutInput,
	UpdateShortcutInput,
} from "../shared/schemas/shortcuts";

const api = {};

const claude = {
	startSession: (input: StartSessionInput) =>
		ipcRenderer.invoke("session:start", input),
	cancelSession: (sessionId: string) =>
		ipcRenderer.invoke("session:cancel", sessionId),
	sendUserMessage: (turn: UserTurn) =>
		ipcRenderer.invoke("session:userMessage", turn),
	finishSession: (sessionId: string) =>
		ipcRenderer.invoke("session:finish", sessionId),
	interruptSession: (sessionId: string) =>
		ipcRenderer.invoke("session:interrupt", sessionId),
	resumeSession: (sessionId: string) =>
		ipcRenderer.invoke("session:resume", sessionId),
	refreshBranch: (sessionId: string) =>
		ipcRenderer.invoke("session:refreshBranch", sessionId),
	switchBranch: (sessionId: string, branch: string) =>
		ipcRenderer.invoke("session:switchBranch", { sessionId, branch }),
	hasUncommittedChanges: (sessionId: string) =>
		ipcRenderer.invoke("session:hasUncommittedChanges", sessionId),
	forkSession: (sessionId: string, messageId: string) =>
		ipcRenderer.invoke("session:fork", { sessionId, messageId }),
	startSidequest: (input: {
		sidequestId: string;
		parentSessionId: string;
		forkMessageId: string;
	}) => ipcRenderer.invoke("sidequest:start", input),
	discardSidequest: (parentSessionId: string) =>
		ipcRenderer.invoke("sidequest:discard", parentSessionId),
	promoteSidequest: (parentSessionId: string, messageId: string) =>
		ipcRenderer.invoke("sidequest:promote", { parentSessionId, messageId }),
	setSessionMode: (sessionId: string, mode: SessionMode) =>
		ipcRenderer.invoke("session:setMode", { sessionId, mode }),
	setSessionModel: (sessionId: string, model?: string) =>
		ipcRenderer.invoke("session:setModel", { sessionId, model }),
	getSupportedModels: (sessionId: string) =>
		ipcRenderer.invoke("session:supportedModels", sessionId),
	respondPermission: (decision: PermissionDecision) =>
		ipcRenderer.send("permission:respond", decision),
	listSessions: () => ipcRenderer.invoke("sessions:list"),
	deleteSession: (sessionId: string) =>
		ipcRenderer.invoke("session:delete", sessionId),
	archiveSession: (sessionId: string) =>
		ipcRenderer.invoke("session:archive", sessionId),
	unarchiveSession: (sessionId: string) =>
		ipcRenderer.invoke("session:unarchive", sessionId),
	renameSession: (sessionId: string, title: string) =>
		ipcRenderer.invoke("session:rename", { sessionId, title }),
	pickFolder: (opts?: { defaultPath?: string }) =>
		ipcRenderer.invoke("dialog:pickFolder", opts ?? {}),
	revealPath: (path: string) => ipcRenderer.invoke("shell:revealPath", path),
	openImageInPreview: (payload: { mediaType?: string; data: string }) =>
		ipcRenderer.invoke("shell:openImage", payload),
	copyImage: (payload: { mediaType?: string; data: string }) =>
		ipcRenderer.invoke("shell:copyImage", payload),
	setUnreadCount: (count: number) =>
		ipcRenderer.send("notifications:setUnreadCount", count),
	listReadState: () => ipcRenderer.invoke("read:list"),
	markRead: (sessionId: string, ts?: number) =>
		ipcRenderer.invoke("read:mark", { sessionId, ts }),
	markUnread: (sessionId: string) =>
		ipcRenderer.invoke("read:markUnread", { sessionId }),
	getSettings: () => ipcRenderer.invoke("settings:get"),
	setLastUsedWorkspace: (cwd: string) =>
		ipcRenderer.invoke("settings:setLastUsedWorkspace", { cwd }),
	setSessionsSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setSessionsSidebarWidth", { width }),
	setNotesSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setNotesSidebarWidth", { width }),
	setSidequestSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setSidequestSidebarWidth", { width }),
	listNotes: (sessionId: string) => ipcRenderer.invoke("notes:list", sessionId),
	createNote: (sessionId: string) =>
		ipcRenderer.invoke("notes:create", sessionId),
	updateNote: (id: string, markdown: string) =>
		ipcRenderer.invoke("notes:update", { id, markdown }),
	deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", id),
	listPermissions: () => ipcRenderer.invoke("permissions:list"),
	getRateLimit: () => ipcRenderer.invoke("rateLimit:get"),
	listWorktrees: () => ipcRenderer.invoke("worktrees:list"),
	listWorktreesForBaseDir: (baseDir: string) =>
		ipcRenderer.invoke("worktrees:listForBaseDir", { baseDir }),
	isGitRepo: (baseDir: string) =>
		ipcRenderer.invoke("worktrees:isGitRepo", { baseDir }),
	getBaseBranch: (baseDir: string) =>
		ipcRenderer.invoke("worktrees:baseBranch", { baseDir }),
	listBranches: (baseDir: string) =>
		ipcRenderer.invoke("worktrees:listBranches", { baseDir }),
	createWorktree: (input: CreateWorktreeInput) =>
		ipcRenderer.invoke("worktrees:create", input),
	deleteWorktree: (id: string) => ipcRenderer.invoke("worktrees:delete", id),
	listGroups: () => ipcRenderer.invoke("groups:list"),
	createGroup: (input: CreateSessionGroupInput) =>
		ipcRenderer.invoke("groups:create", input),
	setSessionGroup: (sessionId: string, groupId: string | null) =>
		ipcRenderer.invoke("groups:setSessionGroup", { sessionId, groupId }),
	setGroupCollapsed: (groupId: string, collapsed: boolean) =>
		ipcRenderer.invoke("groups:setCollapsed", { groupId, collapsed }),
	renameGroup: (groupId: string, name: string) =>
		ipcRenderer.invoke("groups:rename", { groupId, name }),
	listShortcuts: () => ipcRenderer.invoke("shortcuts:list"),
	createShortcut: (input: CreateShortcutInput) =>
		ipcRenderer.invoke("shortcuts:create", input),
	updateShortcut: (input: UpdateShortcutInput) =>
		ipcRenderer.invoke("shortcuts:update", input),
	deleteShortcut: (id: string) => ipcRenderer.invoke("shortcuts:delete", id),
	listSkills: () => ipcRenderer.invoke("skills:list"),
	getAppInfo: () => ipcRenderer.invoke("appInfo:get"),
	toggleDevTools: () => ipcRenderer.invoke("devtools:toggle"),
	checkForUpdate: () => ipcRenderer.invoke("updater:check"),
	installUpdate: (downloadUrl: string) =>
		ipcRenderer.invoke("updater:install", downloadUrl),
	dictationModelStatus: () => ipcRenderer.invoke("dictation:modelStatus"),
	downloadDictationModel: () => ipcRenderer.invoke("dictation:downloadModel"),
	requestMicAccess: () => ipcRenderer.invoke("dictation:requestMicAccess"),
	transcribeDictation: (pcm: Float32Array) =>
		ipcRenderer.invoke("dictation:transcribe", pcm),
	on: (channel: string, fn: (payload: unknown) => void) => {
		const listener = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
		ipcRenderer.on(channel, listener);
		return () => {
			ipcRenderer.removeListener(channel, listener);
		};
	},
};

if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
		contextBridge.exposeInMainWorld("claude", claude);
	} catch (error) {
		console.error(error);
	}
} else {
	// @ts-expect-error global window typing
	window.electron = electronAPI;
	// @ts-expect-error global window typing
	window.api = api;
	// @ts-expect-error global window typing
	window.claude = claude;
}
