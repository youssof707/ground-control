import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
	PermissionDecision,
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../shared/schemas/claude_session";
import type { DeletedSessionSnapshot } from "../shared/claude-sessions/undo";
import type { BabysitConfig } from "../shared/claude-sessions/babysit";
import type { CreateWorktreeInput } from "../shared/schemas/worktrees";
import type { CreateSessionGroupInput } from "../shared/schemas/session_groups";
import type {
	CreateShortcutInput,
	UpdateShortcutInput,
} from "../shared/schemas/shortcuts";
import type {
	CreateScheduleInput,
	UpdateScheduleInput,
} from "../shared/schemas/schedules";

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
	interruptSession: (
		sessionId: string,
		options?: { keepBackgroundTasks?: boolean },
	) => ipcRenderer.invoke("session:interrupt", sessionId, options),
	stopScheduledRun: (sessionId: string) =>
		ipcRenderer.invoke("session:stopScheduledRun", sessionId),
	stopTask: (sessionId: string, taskId: string) =>
		ipcRenderer.invoke("session:stopTask", { sessionId, taskId }),
	listTasks: (sessionId: string) =>
		ipcRenderer.invoke("session:listTasks", sessionId),
	listDetachedTasks: () => ipcRenderer.invoke("session:listDetachedTasks"),
	resumeSession: (sessionId: string) =>
		ipcRenderer.invoke("session:resume", sessionId),
	retryUsageLimit: (sessionId: string) =>
		ipcRenderer.invoke("session:retryUsageLimit", sessionId),
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
		forkMessageId: string | null;
	}) => ipcRenderer.invoke("sidequest:start", input),
	discardSidequest: (parentSessionId: string) =>
		ipcRenderer.invoke("sidequest:discard", parentSessionId),
	promoteSidequest: (parentSessionId: string, messageId: string) =>
		ipcRenderer.invoke("sidequest:promote", { parentSessionId, messageId }),
	setSessionMode: (sessionId: string, mode: SessionMode) =>
		ipcRenderer.invoke("session:setMode", { sessionId, mode }),
	setSessionModel: (sessionId: string, model?: string) =>
		ipcRenderer.invoke("session:setModel", { sessionId, model }),
	getSupportedModels: (sessionId?: string) =>
		ipcRenderer.invoke("session:supportedModels", sessionId),
	respondPermission: (decision: PermissionDecision) =>
		ipcRenderer.send("permission:respond", decision),
	listSessions: () => ipcRenderer.invoke("sessions:list"),
	deleteSession: (sessionId: string) =>
		ipcRenderer.invoke("session:delete", sessionId),
	awaitDeleteHook: (sessionId: string) =>
		ipcRenderer.invoke("session:awaitDeleteHook", sessionId),
	restoreSession: (snapshot: DeletedSessionSnapshot) =>
		ipcRenderer.invoke("session:restore", snapshot),
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
	setDefaultModel: (model?: string) =>
		ipcRenderer.invoke("settings:setDefaultModel", { model }),
	setDefaultBabysit: (config?: BabysitConfig) =>
		ipcRenderer.invoke("settings:setDefaultBabysit", { config }),
	setAutoBabysitNewSessions: (on: boolean) =>
		ipcRenderer.invoke("settings:setAutoBabysitNewSessions", { on }),
	setShowIoTokens: (on: boolean) =>
		ipcRenderer.invoke("settings:setShowIoTokens", { on }),
	setShowContextTokens: (on: boolean) =>
		ipcRenderer.invoke("settings:setShowContextTokens", { on }),
	setSessionsSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setSessionsSidebarWidth", { width }),
	setSidequestSidebarWidth: (width: number) =>
		ipcRenderer.invoke("settings:setSidequestSidebarWidth", { width }),
	setOnSessionDeletePrompt: (prompt?: string) =>
		ipcRenderer.invoke("settings:setOnSessionDeletePrompt", { prompt }),
	listPermissions: () => ipcRenderer.invoke("permissions:list"),
	listBabysit: () => ipcRenderer.invoke("babysit:list"),
	listAutoResumes: () => ipcRenderer.invoke("autoResume:list"),
	setBabysit: (sessionId: string, config: BabysitConfig | null) =>
		ipcRenderer.invoke("babysit:set", { sessionId, config }),
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
	listSchedules: () => ipcRenderer.invoke("schedules:list"),
	createSchedule: (input: CreateScheduleInput) =>
		ipcRenderer.invoke("schedules:create", input),
	updateSchedule: (input: UpdateScheduleInput) =>
		ipcRenderer.invoke("schedules:update", input),
	removeSchedule: (id: string) => ipcRenderer.invoke("schedules:remove", id),
	setScheduleEnabled: (id: string, enabled: boolean) =>
		ipcRenderer.invoke("schedules:setEnabled", { id, enabled }),
	setScheduleAlwaysShowStatus: (id: string, alwaysShowStatus: boolean) =>
		ipcRenderer.invoke("schedules:setAlwaysShowStatus", {
			id,
			alwaysShowStatus,
		}),
	clearScheduleStatus: (id: string) =>
		ipcRenderer.invoke("schedules:clearStatus", id),
	runScheduleNow: (id: string) => ipcRenderer.invoke("schedules:runNow", id),
	listSkills: () => ipcRenderer.invoke("skills:list"),
	openSkillsFolder: () => ipcRenderer.invoke("skills:openFolder"),
	getAppInfo: () => ipcRenderer.invoke("appInfo:get"),
	toggleDevTools: () => ipcRenderer.invoke("devtools:toggle"),
	readActivityLog: () => ipcRenderer.invoke("activityLog:read"),
	clearActivityLog: () => ipcRenderer.invoke("activityLog:clear"),
	revealActivityLog: () => ipcRenderer.invoke("activityLog:reveal"),
	readPmsetSchedule: () => ipcRenderer.invoke("activityLog:pmsetSched"),
	readWakeError: () => ipcRenderer.invoke("activityLog:wakeError"),
	listCaffeinate: () => ipcRenderer.invoke("activityLog:caffeinate"),
	checkForUpdate: () => ipcRenderer.invoke("updater:check"),
	installUpdate: (downloadUrl: string) =>
		ipcRenderer.invoke("updater:install", downloadUrl),
	dictationModelStatus: () => ipcRenderer.invoke("dictation:modelStatus"),
	downloadDictationModel: () => ipcRenderer.invoke("dictation:downloadModel"),
	requestMicAccess: () => ipcRenderer.invoke("dictation:requestMicAccess"),
	transcribeDictation: (pcm: Float32Array) =>
		ipcRenderer.invoke("dictation:transcribe", pcm),
	mcpStatus: (cwd: string) => ipcRenderer.invoke("mcp:status", { cwd }),
	mcpReconnect: (cwd: string, name: string) =>
		ipcRenderer.invoke("mcp:reconnect", { cwd, name }),
	mcpToggle: (cwd: string, name: string, enabled: boolean) =>
		ipcRenderer.invoke("mcp:toggle", { cwd, name, enabled }),
	mcpAuthenticate: (cwd: string, name: string) =>
		ipcRenderer.invoke("mcp:authenticate", { cwd, name }),
	mcpRelease: (cwd: string) => ipcRenderer.invoke("mcp:release", { cwd }),
	listTerminals: () => ipcRenderer.invoke("terminals:list"),
	createTerminal: (cwd?: string, splitFrom?: string) =>
		ipcRenderer.invoke("terminals:create", cwd, splitFrom),
	terminalSnapshot: (id: string) => ipcRenderer.invoke("terminals:snapshot", id),
	killTerminal: (id: string) => ipcRenderer.invoke("terminals:kill", id),
	killTerminalGroup: (groupId: string) =>
		ipcRenderer.invoke("terminals:killGroup", groupId),
	renameTerminalGroup: (groupId: string, name: string) =>
		ipcRenderer.invoke("terminals:renameGroup", groupId, name),
	listTerminalConfigs: () => ipcRenderer.invoke("terminals:listConfigs"),
	saveTerminalConfig: (groupId: string, name: string) =>
		ipcRenderer.invoke("terminals:saveConfig", groupId, name),
	loadTerminalConfig: (configId: string, groupId?: string) =>
		ipcRenderer.invoke("terminals:loadConfig", configId, groupId),
	deleteTerminalConfig: (configId: string) =>
		ipcRenderer.invoke("terminals:deleteConfig", configId),
	writeTerminal: (id: string, data: string) =>
		ipcRenderer.send("terminals:write", id, data),
	resizeTerminal: (id: string, cols: number, rows: number) =>
		ipcRenderer.send("terminals:resize", id, cols, rows),
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
