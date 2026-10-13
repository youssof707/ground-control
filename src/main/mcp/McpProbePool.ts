import {
	query,
	type McpServerStatus,
	type Query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { shell } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type {
	McpAuthStart,
	McpChangedEvent,
	McpServerView,
} from "../../shared/schemas/mcp";
import { resolveClaudeBinary, withTimeout } from "../sessions/SessionManager";
import { spawnClaudeProcess } from "../sessions/spawnClaudeProcess";

const IDLE_TEARDOWN_MS = 10 * 60 * 1000;
const STATUS_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 30_000;
const AUTH_POLL_INTERVAL_MS = 2_000;
const AUTH_POLL_LIMIT_MS = 5 * 60 * 1000;
const WARMUP_WINDOW_MS = 12_000;
const WARMUP_RETRY_MS = 750;

interface McpAuthResponse {
	authUrl?: string;
	requiresUserAction?: boolean;
	callbackExpected?: boolean;
}

type McpAuthCapableQuery = Query & {
	mcpAuthenticate?: (
		serverName: string,
		redirectUri?: string,
	) => Promise<McpAuthResponse>;
};

interface Probe {
	query: McpAuthCapableQuery;
	abort: AbortController;
	idleTimer: ReturnType<typeof setTimeout> | null;
	authPolls: Set<string>;
	startedAt: number;
}

export function toServerView(status: McpServerStatus): McpServerView {
	const config = status.config;
	const transport = config?.type ?? (config ? "stdio" : undefined);
	const target =
		config && "url" in config
			? config.url
			: config && "command" in config
				? [config.command, ...(config.args ?? [])].join(" ")
				: undefined;
	return {
		name: status.name,
		status: status.status,
		scope: status.scope,
		error: status.error,
		transport,
		target,
		tools: (status.tools ?? []).map((t) => ({
			name: t.name,
			description: t.description,
		})),
	};
}

function idlePromptUntil(
	signal: AbortSignal,
): AsyncGenerator<SDKUserMessage, void, void> {
	return (async function* () {
		await new Promise<void>((resolve) => {
			signal.addEventListener("abort", () => resolve(), { once: true });
		});
	})();
}

export class McpProbePool {
	private probes = new Map<string, Probe>();

	constructor(
		private readonly liveQueriesIn: (cwd: string) => Query[],
		private readonly notifyChanged: (event: McpChangedEvent) => void,
	) {}

	async status(cwd: string): Promise<McpServerView[]> {
		const probe = this.acquire(cwd);
		for (;;) {
			const statuses = await withTimeout(
				probe.query.mcpServerStatus(),
				STATUS_TIMEOUT_MS,
				"mcpServerStatus",
			);
			const warmingUp = Date.now() - probe.startedAt < WARMUP_WINDOW_MS;
			if (statuses.length > 0 || !warmingUp) return statuses.map(toServerView);
			await new Promise((resolve) => setTimeout(resolve, WARMUP_RETRY_MS));
		}
	}

	async reconnect(cwd: string, name: string): Promise<void> {
		const probe = this.acquire(cwd);
		await withTimeout(
			probe.query.reconnectMcpServer(name),
			ACTION_TIMEOUT_MS,
			"reconnectMcpServer",
		);
		this.applyToLiveSessions(cwd, (q) => q.reconnectMcpServer(name));
	}

	async toggle(cwd: string, name: string, enabled: boolean): Promise<void> {
		const probe = this.acquire(cwd);
		await withTimeout(
			probe.query.toggleMcpServer(name, enabled),
			ACTION_TIMEOUT_MS,
			"toggleMcpServer",
		);
		this.applyToLiveSessions(cwd, (q) => q.toggleMcpServer(name, enabled));
	}

	async authenticate(cwd: string, name: string): Promise<McpAuthStart> {
		const probe = this.acquire(cwd);
		const authenticate = probe.query.mcpAuthenticate?.bind(probe.query);
		if (!authenticate) {
			throw new Error(
				"This Claude Code version can't start MCP sign-in from Ground Control",
			);
		}
		const response = await withTimeout(
			authenticate(name),
			ACTION_TIMEOUT_MS,
			"mcpAuthenticate",
		);
		if (!response.authUrl || response.requiresUserAction === false) {
			this.applyToLiveSessions(cwd, (q) => q.reconnectMcpServer(name));
			this.notifyChanged({ cwd });
			return { opened: false, awaitingCallback: false };
		}
		await shell.openExternal(response.authUrl);
		const awaitingCallback = response.callbackExpected !== false;
		if (awaitingCallback) this.pollUntilAuthed(cwd, name);
		return { opened: true, awaitingCallback };
	}

	release(cwd: string): void {
		const probe = this.probes.get(cwd);
		if (!probe || probe.authPolls.size > 0) return;
		this.teardown(cwd);
	}

	disposeAll(): void {
		for (const cwd of [...this.probes.keys()]) this.teardown(cwd);
	}

	private acquire(cwd: string): Probe {
		const existing = this.probes.get(cwd);
		if (existing) {
			this.touch(cwd, existing);
			return existing;
		}
		const abort = new AbortController();
		const q = query({
			prompt: idlePromptUntil(abort.signal),
			options: {
				cwd: existsSync(cwd) ? cwd : homedir(),
				pathToClaudeCodeExecutable: resolveClaudeBinary(),
				spawnClaudeCodeProcess: spawnClaudeProcess,
				abortController: abort,
			},
		});
		const probe: Probe = {
			query: q,
			abort,
			idleTimer: null,
			authPolls: new Set(),
			startedAt: Date.now(),
		};
		this.probes.set(cwd, probe);
		this.touch(cwd, probe);
		return probe;
	}

	private touch(cwd: string, probe: Probe): void {
		if (probe.idleTimer) clearTimeout(probe.idleTimer);
		probe.idleTimer = setTimeout(() => {
			if (probe.authPolls.size > 0) {
				this.touch(cwd, probe);
				return;
			}
			this.teardown(cwd);
		}, IDLE_TEARDOWN_MS);
	}

	private teardown(cwd: string): void {
		const probe = this.probes.get(cwd);
		if (!probe) return;
		this.probes.delete(cwd);
		if (probe.idleTimer) clearTimeout(probe.idleTimer);
		probe.authPolls.clear();
		probe.abort.abort();
	}

	private pollUntilAuthed(cwd: string, name: string): void {
		const probe = this.probes.get(cwd);
		if (!probe || probe.authPolls.has(name)) return;
		probe.authPolls.add(name);
		const deadline = Date.now() + AUTH_POLL_LIMIT_MS;
		const tick = async (): Promise<void> => {
			if (this.probes.get(cwd) !== probe || !probe.authPolls.has(name)) return;
			const statuses = await withTimeout(
				probe.query.mcpServerStatus(),
				STATUS_TIMEOUT_MS,
				"mcpServerStatus",
			).catch(() => null);
			const current = statuses?.find((s) => s.name === name);
			const settled =
				current !== undefined &&
				current.status !== "needs-auth" &&
				current.status !== "pending";
			if (settled || Date.now() > deadline) {
				probe.authPolls.delete(name);
				if (settled) {
					this.applyToLiveSessions(cwd, (q) => q.reconnectMcpServer(name));
				}
				this.notifyChanged({ cwd });
				return;
			}
			setTimeout(() => void tick(), AUTH_POLL_INTERVAL_MS);
		};
		setTimeout(() => void tick(), AUTH_POLL_INTERVAL_MS);
	}

	private applyToLiveSessions(
		cwd: string,
		action: (q: Query) => Promise<void>,
	): void {
		for (const q of this.liveQueriesIn(cwd)) {
			void withTimeout(action(q), ACTION_TIMEOUT_MS, "liveMcpSync").catch(
				(err) => console.warn("[ground-control] live MCP sync failed:", err),
			);
		}
	}
}
