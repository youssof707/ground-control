export type SessionStatus =
	| "idle"
	| "running"
	| "awaiting_permission"
	| "done"
	| "errored"
	| "cancelled";

export interface ClaudeSession {
	id: string;
	title: string;
	prompt: string;
	cwd: string;
	status: SessionStatus;
	createdAt: number;
	finishedAt?: number;
	error?: string;
	/** Branch checked out in `cwd` at the moment this session was started. Display-only. */
	branch?: string;
}

export interface StartSessionInput {
	title: string;
	prompt: string;
	cwd: string;
}

export type SessionMessageRole =
	| "user"
	| "assistant"
	| "tool_use"
	| "tool_result"
	| "system"
	| "result";

export interface SessionMessage {
	id: string;
	role: SessionMessageRole;
	content: unknown;
	ts: number;
}

export interface ClaudeSessionFull extends ClaudeSession {
	messages: SessionMessage[];
}

export interface PermissionRequest {
	requestId: string;
	sessionId: string;
	toolName: string;
	input: Record<string, unknown>;
	createdAt: number;
}

export type PermissionDecision =
	| {
		requestId: string;
		behavior: "allow";
		updatedInput?: Record<string, unknown>;
	}
	| { requestId: string; behavior: "deny"; message: string };
