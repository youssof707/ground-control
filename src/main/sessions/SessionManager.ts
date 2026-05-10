import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type { ClaudeSession, StartSessionInput } from "../../shared/claude-sessions/types";
import { PermissionBroker } from "./PermissionBroker";
import { getCurrentBranch } from "./git";

interface RunningEntry {
	session: ClaudeSession;
	abort: AbortController;
}

export class SessionManager {
	private sessions = new Map<string, RunningEntry>();

	constructor(
		private getWin: () => BrowserWindow | null,
		private broker: PermissionBroker,
	) {}

	getSession(id: string): ClaudeSession | undefined {
		return this.sessions.get(id)?.session;
	}

	async run(input: StartSessionInput): Promise<ClaudeSession> {
		const id = randomUUID();
		const branch = await getCurrentBranch(input.cwd);
		const session: ClaudeSession = {
			id,
			title: input.title,
			prompt: input.prompt,
			cwd: input.cwd,
			status: "running",
			createdAt: Date.now(),
			branch,
		};
		const abort = new AbortController();
		this.sessions.set(id, { session, abort });
		this.send("session:started", session);

		try {
			const options: Options = {
				cwd: input.cwd,
				permissionMode: "default",
				canUseTool: (toolName, toolInput) =>
					this.broker.ask({ sessionId: id, toolName, input: toolInput }),
			};

			for await (const msg of query({ prompt: input.prompt, options })) {
				if (abort.signal.aborted) break;
				this.send("session:message", { sessionId: id, msg } satisfies { sessionId: string; msg: SDKMessage });
			}

			if (abort.signal.aborted) {
				session.status = "cancelled";
				session.finishedAt = Date.now();
				this.broker.cancelAllForSession(id);
				this.send("session:cancelled", { sessionId: id });
			} else {
				session.status = "done";
				session.finishedAt = Date.now();
				this.send("session:done", { sessionId: id });
			}
		} catch (err: unknown) {
			session.status = "errored";
			session.error = err instanceof Error ? err.message : String(err);
			session.finishedAt = Date.now();
			this.broker.cancelAllForSession(id, "Session errored");
			this.send("session:errored", { sessionId: id, error: session.error });
		} finally {
			this.sessions.delete(id);
		}

		return session;
	}

	cancel(sessionId: string) {
		this.sessions.get(sessionId)?.abort.abort();
	}

	cancelAll() {
		for (const { abort } of this.sessions.values()) abort.abort();
	}

	private send(channel: string, payload: unknown) {
		const win = this.getWin();
		if (!win || win.isDestroyed()) return;
		win.webContents.send(channel, payload);
	}
}
