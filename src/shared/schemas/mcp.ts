export type McpServerState =
	| "connected"
	| "failed"
	| "needs-auth"
	| "pending"
	| "disabled";

export interface McpToolView {
	name: string;
	description?: string;
}

export interface McpServerView {
	name: string;
	status: McpServerState;
	scope?: string;
	error?: string;
	transport?: string;
	target?: string;
	tools: McpToolView[];
}

export interface McpAuthStart {
	opened: boolean;
	awaitingCallback: boolean;
}

export interface McpChangedEvent {
	cwd: string;
}
