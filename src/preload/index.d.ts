import type {
	ClaudeSession,
	ClaudeSessionFull,
	PermissionDecision,
	PermissionRequest,
	SessionMode,
	StartSessionInput,
	UserTurn,
} from "../shared/schemas/claude_session";
import type { ReadStateFile } from "../shared/schemas/read_state";
import type { AppSettingsFile } from "../shared/schemas/app_settings";
import type { Note } from "../shared/schemas/session_notes";
import type {
	CreateWorktreeInput,
	LocalBranch,
	Worktree,
} from "../shared/schemas/worktrees";
import type {
	CreateSessionGroupInput,
	SessionGroup,
} from "../shared/schemas/session_groups";
import type {
	CreateShortcutInput,
	Shortcut,
	UpdateShortcutInput,
} from "../shared/schemas/shortcuts";
import type {
	ModelInfo,
	SDKRateLimitInfo,
} from "@anthropic-ai/claude-agent-sdk";

export type { ModelInfo };

export type RateLimitType = NonNullable<SDKRateLimitInfo["rateLimitType"]>;
export type RateLimitSnapshot = Partial<Record<RateLimitType, SDKRateLimitInfo>>;

declare global {
	interface Window {
		claude: {
			startSession: (input: StartSessionInput) => Promise<ClaudeSession>;
			cancelSession: (sessionId: string) => Promise<void>;
			sendUserMessage: (turn: UserTurn) => Promise<void>;
			finishSession: (sessionId: string) => Promise<void>;
			interruptSession: (sessionId: string) => Promise<void>;
			resumeSession: (sessionId: string) => Promise<void>;
			refreshBranch: (sessionId: string) => Promise<void>;
			switchBranch: (sessionId: string, branch: string) => Promise<void>;
			hasUncommittedChanges: (sessionId: string) => Promise<boolean>;
			forkSession: (
				sessionId: string,
				messageId: string,
			) => Promise<ClaudeSession>;
			setSessionMode: (
				sessionId: string,
				mode: SessionMode,
			) => Promise<void>;
			setSessionModel: (
				sessionId: string,
				model?: string,
			) => Promise<void>;
			getSupportedModels: (sessionId: string) => Promise<ModelInfo[]>;
			respondPermission: (decision: PermissionDecision) => void;
			listSessions: () => Promise<ClaudeSessionFull[]>;
			deleteSession: (sessionId: string) => Promise<void>;
			archiveSession: (sessionId: string) => Promise<void>;
			unarchiveSession: (sessionId: string) => Promise<void>;
			renameSession: (sessionId: string, title: string) => Promise<void>;
			pickFolder: (opts?: { defaultPath?: string }) => Promise<string | null>;
			revealPath: (path: string) => Promise<void>;
			openImageInPreview: (payload: {
				mediaType?: string;
				data: string;
			}) => Promise<void>;
			copyImage: (payload: {
				mediaType?: string;
				data: string;
			}) => Promise<void>;
			setUnreadCount: (count: number) => void;
			listReadState: () => Promise<ReadStateFile>;
			markRead: (sessionId: string, ts?: number) => Promise<void>;
			markUnread: (sessionId: string) => Promise<void>;
			getSettings: () => Promise<AppSettingsFile>;
			setLastUsedWorkspace: (cwd: string) => Promise<void>;
			setSessionsSidebarWidth: (width: number) => Promise<void>;
			setNotesSidebarWidth: (width: number) => Promise<void>;
			listNotes: (sessionId: string) => Promise<Note[]>;
			createNote: (sessionId: string) => Promise<Note>;
			updateNote: (id: string, markdown: string) => Promise<Note | null>;
			deleteNote: (id: string) => Promise<void>;
			listPermissions: () => Promise<PermissionRequest[]>;
			getRateLimit: () => Promise<RateLimitSnapshot>;
			listWorktrees: () => Promise<Worktree[]>;
			listWorktreesForBaseDir: (baseDir: string) => Promise<Worktree[]>;
			isGitRepo: (baseDir: string) => Promise<boolean>;
			getBaseBranch: (baseDir: string) => Promise<string | undefined>;
			listBranches: (baseDir: string) => Promise<LocalBranch[]>;
			createWorktree: (input: CreateWorktreeInput) => Promise<Worktree>;
			deleteWorktree: (id: string) => Promise<void>;
			listGroups: () => Promise<SessionGroup[]>;
			createGroup: (input: CreateSessionGroupInput) => Promise<SessionGroup>;
			setSessionGroup: (
				sessionId: string,
				groupId: string | null,
			) => Promise<void>;
			setGroupCollapsed: (
				groupId: string,
				collapsed: boolean,
			) => Promise<void>;
			renameGroup: (groupId: string, name: string) => Promise<void>;
			listShortcuts: () => Promise<Shortcut[]>;
			createShortcut: (input: CreateShortcutInput) => Promise<Shortcut>;
			updateShortcut: (input: UpdateShortcutInput) => Promise<Shortcut>;
			deleteShortcut: (id: string) => Promise<void>;
			getAppInfo: () => Promise<{
				env: "dev" | "prod";
				storeFolder: string;
			}>;
			toggleDevTools: () => Promise<void>;
			checkForUpdate: () => Promise<{
				available: boolean;
				currentVersion: string;
				latestVersion: string | null;
				downloadUrl: string | null;
				releaseUrl: string | null;
				releaseNotes: string | null;
				error?: string;
			}>;
			installUpdate: (downloadUrl: string) => Promise<void>;
			dictationModelStatus: () => Promise<{
				state: "ready" | "absent" | "downloading";
			}>;
			downloadDictationModel: () => Promise<void>;
			requestMicAccess: () => Promise<boolean>;
			transcribeDictation: (pcm: Float32Array) => Promise<string>;
			on: (channel: string, fn: (payload: unknown) => void) => () => void;
		};
	}
}

export {};
