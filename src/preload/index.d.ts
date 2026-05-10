import type {
	ClaudeSession,
	ClaudeSessionFull,
	PermissionDecision,
	StartSessionInput,
	UserTurn,
} from "../shared/schemas/claude_session";

declare global {
	interface Window {
		claude: {
			startSession: (input: StartSessionInput) => Promise<ClaudeSession>;
			cancelSession: (sessionId: string) => Promise<void>;
			sendUserMessage: (turn: UserTurn) => Promise<void>;
			finishSession: (sessionId: string) => Promise<void>;
			interruptSession: (sessionId: string) => Promise<void>;
			resumeSession: (sessionId: string) => Promise<void>;
			respondPermission: (decision: PermissionDecision) => void;
			listSessions: () => Promise<ClaudeSessionFull[]>;
			deleteSession: (sessionId: string) => Promise<void>;
			on: (channel: string, fn: (payload: unknown) => void) => () => void;
		};
	}
}

export {};
