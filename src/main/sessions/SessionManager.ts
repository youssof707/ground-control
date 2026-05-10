import {
	query,
	type Options,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type {
	ClaudeSession,
	ClaudeSessionFull,
	SessionMessage,
	StartSessionInput,
	UserContentBlock,
} from "../../shared/schemas/claude_session";
import { PermissionBroker } from "./PermissionBroker";
import { getCurrentBranch, getDiffSinceCommit, getHeadCommit } from "./git";
import * as sessionStore from "../core/store/claude_session";

interface RunningEntry {
	session: ClaudeSession;
	abort: AbortController;
	pushTurn: (blocks: UserContentBlock[]) => void;
	finish: () => void;
	setIdle: () => Promise<void>;
	queryRef: { current: Query | null };
}

function roleFromSdkMessage(
	msg: SDKMessage,
): "assistant" | "user" | "system" | "result" {
	if (msg.type === "assistant") return "assistant";
	if (msg.type === "user") return "user";
	if (msg.type === "system") return "system";
	return "result";
}

function extractSdkSessionId(msg: SDKMessage): string | undefined {
	const sid = (msg as { session_id?: unknown }).session_id;
	return typeof sid === "string" ? sid : undefined;
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

	get activeCount(): number {
		return this.sessions.size;
	}

	listActive(): ClaudeSession[] {
		return Array.from(this.sessions.values()).map((e) => e.session);
	}

	async run(input: StartSessionInput): Promise<ClaudeSession> {
		const id = randomUUID();
		const [branch, startCommit] = await Promise.all([
			getCurrentBranch(input.cwd),
			getHeadCommit(input.cwd),
		]);
		const hasInitialPrompt = !!input.prompt && input.prompt.trim().length > 0;
		const session: ClaudeSession = {
			id,
			title: input.title,
			prompt: input.prompt ?? "",
			cwd: input.cwd,
			status: hasInitialPrompt ? "running" : "idle",
			createdAt: Date.now(),
			branch,
			startCommit,
		};

		const fullForPersist: ClaudeSessionFull = { ...session, messages: [] };
		try {
			await sessionStore.createSession(fullForPersist);
		} catch (err) {
			console.error("[ccw] failed to persist session:", err);
		}

		const initialTurns: UserContentBlock[][] = hasInitialPrompt
			? [[{ type: "text", text: input.prompt as string }]]
			: [];

		await this.runLoop({
			session,
			cwd: input.cwd,
			startCommit,
			initialTurns,
			resumeSdkSessionId: undefined,
		});

		return session;
	}

	async resume(wrapperId: string): Promise<void> {
		if (this.sessions.has(wrapperId)) {
			throw new Error("Session is already active");
		}
		const persisted = sessionStore.getSession(wrapperId);
		if (!persisted) throw new Error("Session not found");
		if (!persisted.sdkSessionId) {
			throw new Error(
				"This session has no SDK session id and can't be resumed",
			);
		}

		// Refresh branch/startCommit — the working tree has likely moved on.
		const [branch, startCommit] = await Promise.all([
			getCurrentBranch(persisted.cwd),
			getHeadCommit(persisted.cwd),
		]);

		const session: ClaudeSession = {
			id: persisted.id,
			title: persisted.title,
			prompt: persisted.prompt,
			cwd: persisted.cwd,
			status: "idle",
			createdAt: persisted.createdAt,
			branch,
			startCommit,
			sdkSessionId: persisted.sdkSessionId,
		};

		await sessionStore.updateSession(persisted.id, {
			status: "idle",
			finishedAt: undefined,
			error: undefined,
			branch,
			startCommit,
		});

		// Don't await — runLoop runs the SDK loop until it ends.
		void this.runLoop({
			session,
			cwd: persisted.cwd,
			startCommit,
			initialTurns: [],
			resumeSdkSessionId: persisted.sdkSessionId,
		});
	}

	private async runLoop(cfg: {
		session: ClaudeSession;
		cwd: string;
		startCommit: string | undefined;
		initialTurns: UserContentBlock[][];
		resumeSdkSessionId: string | undefined;
	}): Promise<void> {
		const { session, cwd, startCommit } = cfg;
		const id = session.id;

		const turns: UserContentBlock[][] = [...cfg.initialTurns];
		const state: {
			waitForTurn: (() => void) | null;
			finished: boolean;
		} = { waitForTurn: null, finished: false };

		const pushTurn = (blocks: UserContentBlock[]) => {
			turns.push(blocks);
			state.waitForTurn?.();
		};
		const finish = () => {
			state.finished = true;
			state.waitForTurn?.();
		};

		const setRunning = () => {
			if (session.status === "running") return;
			session.status = "running";
			this.send("session:status", { sessionId: id, status: "running" });
			void sessionStore.updateSession(id, { status: "running" });
		};
		const setIdle = async () => {
			if (session.status !== "running") return;
			session.status = "idle";
			const diff = await this.captureDiff(cwd, startCommit);
			session.diff = diff;
			this.send("session:status", {
				sessionId: id,
				status: "idle",
				diff,
			});
			void sessionStore.updateSession(id, { status: "idle", diff });
		};

		const pushTurnWithStatus = (blocks: UserContentBlock[]) => {
			pushTurn(blocks);
			setRunning();
		};

		async function* userStream(): AsyncIterable<SDKUserMessage> {
			while (true) {
				while (turns.length > 0) {
					const blocks = turns.shift();
					if (!blocks) continue;
					yield {
						type: "user",
						message: { role: "user", content: blocks },
						parent_tool_use_id: null,
					} satisfies SDKUserMessage;
				}
				if (state.finished) return;
				await new Promise<void>((resolve) => {
					state.waitForTurn = resolve;
				});
				state.waitForTurn = null;
			}
		}

		const abort = new AbortController();
		const queryRef: { current: Query | null } = { current: null };
		this.sessions.set(id, {
			session,
			abort,
			pushTurn: pushTurnWithStatus,
			finish,
			setIdle,
			queryRef,
		});
		this.send("session:started", session);

		let sdkIdCaptured = !!session.sdkSessionId;

		try {
			const options: Options = {
				cwd,
				permissionMode: "default",
				canUseTool: (toolName, toolInput) =>
					this.broker.ask({ sessionId: id, toolName, input: toolInput }),
				...(cfg.resumeSdkSessionId
					? { resume: cfg.resumeSdkSessionId }
					: {}),
			};

			const q = query({ prompt: userStream(), options });
			queryRef.current = q;
			for await (const msg of q) {
				if (abort.signal.aborted) break;

				if (!sdkIdCaptured) {
					const sid = extractSdkSessionId(msg);
					if (sid) {
						session.sdkSessionId = sid;
						sdkIdCaptured = true;
						void sessionStore.updateSession(id, { sdkSessionId: sid });
					}
				}

				const sessionMessage: SessionMessage = {
					id: randomUUID(),
					role: roleFromSdkMessage(msg),
					content: msg as unknown,
					ts: Date.now(),
				};
				this.send("session:message", {
					sessionId: id,
					message: sessionMessage,
				});
				void sessionStore.appendMessage(id, sessionMessage);
				if (msg.type === "result") await setIdle();
			}

			if (abort.signal.aborted) {
				session.status = "cancelled";
				session.finishedAt = Date.now();
				session.diff = await this.captureDiff(cwd, startCommit);
				this.broker.cancelAllForSession(id);
				this.send("session:cancelled", {
					sessionId: id,
					diff: session.diff,
				});
				void sessionStore.updateSession(id, {
					status: "cancelled",
					finishedAt: session.finishedAt,
					diff: session.diff,
				});
			} else {
				session.status = "done";
				session.finishedAt = Date.now();
				session.diff = await this.captureDiff(cwd, startCommit);
				this.send("session:done", {
					sessionId: id,
					diff: session.diff,
				});
				void sessionStore.updateSession(id, {
					status: "done",
					finishedAt: session.finishedAt,
					diff: session.diff,
				});
			}
		} catch (err: unknown) {
			session.status = "errored";
			session.error = err instanceof Error ? err.message : String(err);
			session.finishedAt = Date.now();
			session.diff = await this.captureDiff(cwd, startCommit);
			this.broker.cancelAllForSession(id, "Session errored");
			this.send("session:errored", {
				sessionId: id,
				error: session.error,
				diff: session.diff,
			});
			void sessionStore.updateSession(id, {
				status: "errored",
				finishedAt: session.finishedAt,
				error: session.error,
				diff: session.diff,
			});
		} finally {
			state.finished = true;
			state.waitForTurn?.();
			this.sessions.delete(id);
		}
	}

	pushUserMessage(sessionId: string, blocks: UserContentBlock[]) {
		const entry = this.sessions.get(sessionId);
		if (!entry) throw new Error(`No active session ${sessionId}`);
		entry.pushTurn(blocks);

		// Persist the user message so it survives restart even though the SDK
		// doesn't echo user-pushed turns back through the message stream.
		const sessionMessage: SessionMessage = {
			id: randomUUID(),
			role: "user",
			content: { type: "user", message: { role: "user", content: blocks } },
			ts: Date.now(),
		};
		void sessionStore.appendMessage(sessionId, sessionMessage);
	}

	finish(sessionId: string) {
		this.sessions.get(sessionId)?.finish();
	}

	async interrupt(sessionId: string) {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		try {
			await entry.queryRef.current?.interrupt();
		} catch (err) {
			console.error("[ccw] interrupt failed:", err);
		}
		await entry.setIdle();
	}

	cancel(sessionId: string) {
		this.sessions.get(sessionId)?.abort.abort();
	}

	cancelAll() {
		for (const { abort } of this.sessions.values()) abort.abort();
	}

	private async captureDiff(
		cwd: string,
		startCommit: string | undefined,
	): Promise<string | undefined> {
		if (!startCommit) return undefined;
		return getDiffSinceCommit(cwd, startCommit);
	}

	private send(channel: string, payload: unknown) {
		const win = this.getWin();
		if (!win || win.isDestroyed()) return;
		win.webContents.send(channel, payload);
	}
}
