import type {
	ClaudeSession,
	PermissionDecision,
	StartSessionInput,
} from "../shared/claude-sessions/types";

declare global {
	interface Window {
		claude: {
			startSession: (input: StartSessionInput) => Promise<ClaudeSession>;
			cancelSession: (sessionId: string) => Promise<void>;
			respondPermission: (decision: PermissionDecision) => void;
			on: (channel: string, fn: (payload: unknown) => void) => () => void;
		};
	}
}

export {};
