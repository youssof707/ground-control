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
	Worktree,
	ListWorktreesForSessionResult,
} from "../shared/schemas/worktree";
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

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
			respondPermission: (decision: PermissionDecision) => void;
			listSessions: () => Promise<ClaudeSessionFull[]>;
			deleteSession: (
				sessionId: string,
				opts?: { alsoDeleteWorktree?: boolean },
			) => Promise<void>;
			archiveSession: (sessionId: string) => Promise<void>;
			unarchiveSession: (sessionId: string) => Promise<void>;
			renameSession: (sessionId: string, title: string) => Promise<void>;
			pickFolder: (opts?: { defaultPath?: string }) => Promise<string | null>;
			revealPath: (path: string) => Promise<void>;
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
			getAppInfo: () => Promise<{
				env: "dev" | "prod";
				storeFolder: string;
			}>;
			toggleDevTools: () => Promise<void>;
			listWorktrees: () => Promise<Worktree[]>;
			listWorktreesForCwd: (
				cwd: string,
			) => Promise<ListWorktreesForSessionResult>;
			peekWorktreeBaseRefForCwd: (cwd: string) => Promise<string | null>;
			on: (channel: string, fn: (payload: unknown) => void) => () => void;
		};
	}
}

export {};
