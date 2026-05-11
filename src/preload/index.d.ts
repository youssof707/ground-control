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
import type { MinimizedStateFile } from "../shared/schemas/minimized_state";
import type { AppSettingsFile } from "../shared/schemas/app_settings";

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
			deleteSession: (sessionId: string) => Promise<void>;
			renameSession: (sessionId: string, title: string) => Promise<void>;
			pickFolder: (opts?: { defaultPath?: string }) => Promise<string | null>;
			setUnreadCount: (count: number) => void;
			listReadState: () => Promise<ReadStateFile>;
			markRead: (sessionId: string, ts?: number) => Promise<void>;
			listMinimized: () => Promise<MinimizedStateFile>;
			setMinimized: (sessionId: string, value: boolean) => Promise<void>;
			getSettings: () => Promise<AppSettingsFile>;
			setLastUsedWorkspace: (cwd: string) => Promise<void>;
			setSessionsSidebarWidth: (width: number) => Promise<void>;
			listPermissions: () => Promise<PermissionRequest[]>;
			getAppInfo: () => Promise<{
				env: "dev" | "prod";
				storeFolder: string;
			}>;
			on: (channel: string, fn: (payload: unknown) => void) => () => void;
		};
	}
}

export {};
