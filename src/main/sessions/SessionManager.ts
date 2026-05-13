import {
	forkSession as sdkForkSession,
	query,
	type Options,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

function resolveClaudeBinary(): string {
	const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	const ext = process.platform === "win32" ? "claude.exe" : "claude";
	const root = app.getAppPath().replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
	return join(root, "node_modules", pkg, ext);
}
import type {
	ClaudeSession,
	ClaudeSessionFull,
	SessionMessage,
	SessionMode,
	StartSessionInput,
	UserContentBlock,
} from "../../shared/schemas/claude_session";
import { PermissionBroker } from "./PermissionBroker";
import {
	getCurrentBranch,
	getDefaultBaseBranch,
	getDiffSinceCommit,
	getHeadCommit,
	hasUncommittedChanges,
	switchBranch,
} from "./git";
import * as sessionStore from "../core/store/claude_session";
import * as rateLimitTracker from "./RateLimitTracker";
import * as windows from "../windows";

interface RunningEntry {
	session: ClaudeSession;
	abort: AbortController;
	pushTurn: (blocks: UserContentBlock[]) => void;
	finish: () => void;
	setIdle: () => Promise<void>;
	queryRef: { current: Query | null };
	// Resolves once runLoop's finally block has run and the entry has been
	// removed from `sessions`. Lets callers (e.g. session:delete) await
	// complete SDK teardown before continuing.
	done: Promise<void>;
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

function logSdkErrors(sessionId: string, msg: SDKMessage): void {
	if (msg.type === "result") {
		const r = msg as unknown as {
			is_error?: boolean;
			subtype?: string;
			result?: unknown;
		};
		if (r.is_error || (r.subtype && r.subtype !== "success")) {
			console.error(
				`[session ${sessionId}] result error subtype=${r.subtype ?? "unknown"}`,
				r.result ?? r,
			);
		}
	}
	// tool_result errors are intentionally not logged — they fire constantly
	// during normal use (permission denials, <tool_use_error>, InputValidationError)
	// and drowned out genuine errors.
}

function sdkPermissionModeFor(mode: SessionMode): "plan" | "acceptEdits" {
	return mode === "plan" ? "plan" : "acceptEdits";
}

function deriveTitle(text: string, maxLen = 60): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return "";
	if (cleaned.length <= maxLen) return cleaned;
	return cleaned.slice(0, maxLen - 1) + "…";
}

function firstTextFromBlocks(blocks: UserContentBlock[]): string {
	for (const b of blocks) {
		if (b.type === "text" && b.text.trim().length > 0) return b.text;
	}
	return "";
}

export class SessionManager {
	private sessions = new Map<string, RunningEntry>();
	// Tombstones for deleted sessions. Once an id lands here, `send()` drops
	// any subsequent broadcast referring to it so leaked SDK events from a
	// still-winding-down loop can't resurrect the row in any renderer
	// (which lazy-creates entries from upsert payloads). UUIDs are random,
	// so we don't need to evict — one entry per delete per process lifetime.
	private deletedIds = new Set<string>();

	constructor(private broker: PermissionBroker) {}

	/**
	 * Mark a session id as deleted. After this point, `send()` drops any
	 * broadcast whose payload references the id, regardless of whether the
	 * SDK loop has finished tearing down. Idempotent.
	 */
	markDeleted(id: string): void {
		this.deletedIds.add(id);
	}

	getSession(id: string): ClaudeSession | undefined {
		return this.sessions.get(id)?.session;
	}

	get activeCount(): number {
		let n = 0;
		for (const { session } of this.sessions.values()) {
			if (session.status === "running") n++;
		}
		return n;
	}

	listActive(): ClaudeSession[] {
		return Array.from(this.sessions.values()).map((e) => e.session);
	}

	async run(input: StartSessionInput): Promise<ClaudeSession> {
		const id = randomUUID();
		const [branch, startCommit, defaultBaseBranch] = await Promise.all([
			getCurrentBranch(input.cwd),
			getHeadCommit(input.cwd),
			getDefaultBaseBranch(input.cwd),
		]);
		const hasInitialPrompt = !!input.prompt && input.prompt.trim().length > 0;
		const derivedTitle = hasInitialPrompt
			? deriveTitle(input.prompt as string)
			: "";
		const session: ClaudeSession = {
			id,
			title: derivedTitle || input.title,
			prompt: input.prompt ?? "",
			cwd: input.cwd,
			status: hasInitialPrompt ? "running" : "idle",
			createdAt: Date.now(),
			branch,
			startCommit,
			// Seed the staleness baseline with the project's default base
			// branch so the BranchChip immediately flags drift when the user
			// creates a session on a feature branch — without having to wait
			// for the first user message. `snapshotBranchCheckpoint` will
			// naturally overwrite this on the first user input, so it's a
			// pure pre-message hint. Stays undefined when detection fails
			// (no git repo, no origin/HEAD, no main/master) — same as today.
			lastUserMessageBranch: defaultBaseBranch,
			// Every session is created in one of the two app-level modes.
			// New sessions default to "plan"; the renderer can pre-pick a mode
			// in StartSessionInput if it ever wants to.
			mode: input.mode ?? "plan",
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

	/**
	 * Fork a session from a specific assistant message. Creates a new wrapper
	 * session whose transcript is the parent's history truncated to (and
	 * including) the target message, backed by a brand-new Claude Agent SDK
	 * session that the SDK forks for us (preserving the parentUuid chain with
	 * fresh UUIDs).
	 *
	 * The parent session is untouched — fork operates on the on-disk JSONL
	 * snapshot so it's safe to call while the parent is mid-stream.
	 *
	 * After persisting the new session, we auto-resume it so its SDK loop is
	 * live and the composer's `pushUserMessage` flow works immediately when
	 * the renderer navigates to it.
	 */
	async fork(
		parentWrapperId: string,
		wrapperMessageId: string,
	): Promise<ClaudeSession> {
		const parent = sessionStore.getSession(parentWrapperId);
		if (!parent) throw new Error("Parent session not found");
		if (!parent.sdkSessionId) {
			throw new Error(
				"This session has no SDK session id yet — wait for Claude's first response before forking.",
			);
		}

		const msgIndex = parent.messages.findIndex(
			(m) => m.id === wrapperMessageId,
		);
		if (msgIndex < 0) throw new Error("Message not found in this session");
		const targetMsg = parent.messages[msgIndex];
		if (targetMsg.role !== "assistant") {
			throw new Error("Can only fork from an assistant message");
		}
		const sdkUuid = (targetMsg.content as { uuid?: unknown }).uuid;
		if (typeof sdkUuid !== "string" || sdkUuid.length === 0) {
			throw new Error(
				"This message has no SDK uuid and can't be used as a fork point",
			);
		}

		const truncated = parent.messages.slice(0, msgIndex + 1);
		const newTitle = `${parent.title} (fork)`;

		const { sessionId: newSdkId } = await sdkForkSession(parent.sdkSessionId, {
			upToMessageId: sdkUuid,
			title: newTitle,
		});

		// Refresh git context — the working tree may have moved on since the
		// parent started.
		const [branch, startCommit] = await Promise.all([
			getCurrentBranch(parent.cwd),
			getHeadCommit(parent.cwd),
		]);

		const newWrapperId = randomUUID();
		const newSessionFull: ClaudeSessionFull = {
			id: newWrapperId,
			title: newTitle,
			prompt: "",
			cwd: parent.cwd,
			status: "idle",
			createdAt: Date.now(),
			branch,
			startCommit,
			sdkSessionId: newSdkId,
			mode: parent.mode,
			// Re-id each entry so they don't collide with the parent's message
			// ids in the renderer's flat store. Original SDK content and
			// timestamps are preserved.
			messages: truncated.map((m) => ({
				id: randomUUID(),
				role: m.role,
				content: m.content,
				ts: m.ts,
			})),
		};

		try {
			await sessionStore.createSession(newSessionFull);
		} catch (err) {
			console.error("[ccw] failed to persist forked session:", err);
			throw err;
		}

		const newSession: ClaudeSession = {
			id: newSessionFull.id,
			title: newSessionFull.title,
			prompt: newSessionFull.prompt,
			cwd: newSessionFull.cwd,
			status: newSessionFull.status,
			createdAt: newSessionFull.createdAt,
			branch: newSessionFull.branch,
			startCommit: newSessionFull.startCommit,
			sdkSessionId: newSessionFull.sdkSessionId,
			mode: newSessionFull.mode,
		};

		// Tell the renderer the new session exists, then hydrate its history
		// in a single patch. Sending session:message per-message here used to
		// cause a ~5s renderer freeze: each event drove its own Zustand
		// mutation + full re-render, and MessageView/MarkdownText are not
		// memoized, so every render re-ran rehype-highlight on every message
		// (O(N²) sync work on the main thread).
		//
		// One patch = one store mutation = one render. upsertSession does a
		// shallow merge, so `messages` is replaced atomically.
		//
		// resume() below fires its own session:started for the runtime entry;
		// its payload has no `messages` field, so the merge preserves the
		// history we set here.
		this.send("session:started", newSession);
		this.send("session:patch", {
			sessionId: newWrapperId,
			messages: newSessionFull.messages,
		});

		// Spin up the SDK loop in the background so the composer can push user
		// turns. resume() is non-blocking (it `void`s runLoop internally).
		try {
			await this.resume(newWrapperId);
		} catch (err) {
			console.error("[ccw] auto-resume after fork failed:", err);
		}

		return newSession;
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
			// Persisted mode wins on resume. Pre-existing rows without a
			// mode field were backfilled to "plan" by the Zod schema default
			// when the store loaded them.
			mode: persisted.mode,
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
		let resolveDone!: () => void;
		const done = new Promise<void>((r) => {
			resolveDone = r;
		});
		this.sessions.set(id, {
			session,
			abort,
			pushTurn: pushTurnWithStatus,
			finish,
			setIdle,
			queryRef,
			done,
		});
		this.send("session:started", session);

		let sdkIdCaptured = !!session.sdkSessionId;

		try {
			const options: Options = {
				cwd,
				// Map our 2-state app mode to the SDK's permissionMode.
				// "plan"        → SDK "plan"        (no edits, planning only)
				// "acceptEdits" → SDK "acceptEdits" (file edits auto-approved;
				//                                    other tools still hit the broker)
				permissionMode: sdkPermissionModeFor(session.mode),
				pathToClaudeCodeExecutable: resolveClaudeBinary(),
				canUseTool: async (toolName, toolInput) => {
					const result = await this.broker.ask({
						sessionId: id,
						toolName,
						input: toolInput,
					});
					if (
						toolName === "ExitPlanMode" &&
						result.behavior === "allow" &&
						session.mode === "plan"
					) {
						// Fire-and-forget: must not block the SDK's canUseTool
						// resolution. setMode calls setPermissionMode on the same
						// Query the SDK is currently awaiting us on — awaiting it
						// here risks reentrancy. Scheduling it on the next
						// microtask also lands after the SDK's own post-
						// ExitPlanMode internal mode transition, so our
						// "acceptEdits" is the final write.
						this.setMode(id, "acceptEdits").catch((err) => {
							console.error(
								"[ccw] auto-flip to acceptEdits after ExitPlanMode failed:",
								err,
							);
						});
					}
					return result;
				},
				...(cfg.resumeSdkSessionId
					? { resume: cfg.resumeSdkSessionId }
					: {}),
			};

			const q = query({ prompt: userStream(), options });
			queryRef.current = q;
			for await (const msg of q) {
				if (abort.signal.aborted) break;

				// Subscription rate-limit signal — transient state, not part of the
				// transcript. Hand off to the tracker (which broadcasts to renderers)
				// and skip the persist/append path so it doesn't bloat the session
				// JSON or render in the chat scroll.
				if (msg.type === "rate_limit_event") {
					rateLimitTracker.update(msg.rate_limit_info);
					continue;
				}

				logSdkErrors(id, msg);

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
			resolveDone();
		}
	}

	pushUserMessage(sessionId: string, blocks: UserContentBlock[]) {
		const entry = this.sessions.get(sessionId);
		if (!entry) throw new Error(`No active session ${sessionId}`);

		// If this is the first user input on a session that started without an
		// initial prompt, derive a meaningful title from the message text.
		const persisted = sessionStore.getSession(sessionId);
		const hasNoPriorUserMessage =
			!!persisted && !persisted.messages.some((m) => m.role === "user");
		const hasNoPriorPrompt =
			!entry.session.prompt || entry.session.prompt.trim().length === 0;
		if (hasNoPriorUserMessage && hasNoPriorPrompt) {
			const text = firstTextFromBlocks(blocks);
			const title = deriveTitle(text);
			if (title && title !== entry.session.title) {
				entry.session.title = title;
				this.send("session:patch", { sessionId, title });
				void sessionStore.updateSession(sessionId, { title });
			}
		}

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

		this.snapshotBranchCheckpoint(sessionId);
	}

	/**
	 * Record the current branch as the user's "checkpoint" baseline for this
	 * session. Called whenever the user actively interacts with the session
	 * — sending a message, or answering a permission / plan / ask-user
	 * prompt — so the chip's red stale state dismisses naturally on any
	 * forward motion, not just messages.
	 *
	 * Fire-and-forget: the git shell-out is decoupled from the caller's
	 * critical path. Worst case the chip's red→normal flip lags by one tick.
	 * Best-effort: any failure here is swallowed (chip just won't update).
	 *
	 * Also refreshes `session.branch` so the displayed name keeps up without
	 * waiting for the next session open.
	 */
	snapshotBranchCheckpoint(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		const cwd = entry?.session.cwd ?? sessionStore.getSession(sessionId)?.cwd;
		if (!cwd) return;
		void (async () => {
			try {
				const branch = await getCurrentBranch(cwd);
				if (entry) {
					entry.session.branch = branch;
					entry.session.lastUserMessageBranch = branch;
				}
				this.send("session:patch", {
					sessionId,
					branch,
					lastUserMessageBranch: branch,
				});
				await sessionStore.updateSession(sessionId, {
					branch,
					lastUserMessageBranch: branch,
				});
			} catch (err) {
				console.error("[ccw] snapshotBranchCheckpoint failed:", err);
			}
		})();
	}

	finish(sessionId: string) {
		this.sessions.get(sessionId)?.finish();
	}

	/**
	 * Re-read the current git branch for a session's cwd and, if it differs
	 * from the persisted value, update + broadcast it. Used when the user
	 * opens / switches to a session so the chip reflects whatever `git
	 * switch`es happened while the session was off-screen.
	 *
	 * Works whether or not the session is currently running — falls back to
	 * the persisted record so stopped sessions still get their chip refreshed.
	 * Best-effort: any failure here is swallowed (chip just won't refresh).
	 */
	async refreshBranch(sessionId: string): Promise<void> {
		const entry = this.sessions.get(sessionId);
		const cwd = entry?.session.cwd ?? sessionStore.getSession(sessionId)?.cwd;
		if (!cwd) return;
		const previous =
			entry?.session.branch ?? sessionStore.getSession(sessionId)?.branch;
		const branch = await getCurrentBranch(cwd);
		if (branch === previous) return;
		if (entry) entry.session.branch = branch;
		await sessionStore.updateSession(sessionId, { branch });
		this.send("session:patch", { sessionId, branch });
	}

	/**
	 * Run `git switch <branch>` in the session's cwd, then refresh + broadcast
	 * the new branch so the chip clears its red state. Throws on git failure
	 * (branch missing, uncommitted changes, etc.) so the renderer can show
	 * the error inline next to the Switch button.
	 *
	 * Deliberately does NOT update `lastUserMessageBranch`: a branch switch
	 * is a working-tree move, not a "user checkpoint." If the user switches
	 * to a third branch (neither current nor baseline), the chip stays red
	 * with the new "Previously working on" hint still pointing at the
	 * original baseline — which is the correct behavior.
	 */
	async switchBranchInSession(
		sessionId: string,
		branch: string,
	): Promise<void> {
		const entry = this.sessions.get(sessionId);
		const cwd = entry?.session.cwd ?? sessionStore.getSession(sessionId)?.cwd;
		if (!cwd) throw new Error(`No session ${sessionId}`);
		await switchBranch(cwd, branch);
		await this.refreshBranch(sessionId);
	}

	/**
	 * Best-effort "are there modified tracked files in this session's cwd"
	 * check. Used by the renderer pre-flight before running `git switch` so
	 * we can pop a confirm modal instead of silently letting git refuse.
	 * Returns false on any error — see `hasUncommittedChanges` in git.ts.
	 */
	async hasUncommittedChangesInSession(sessionId: string): Promise<boolean> {
		const entry = this.sessions.get(sessionId);
		const cwd = entry?.session.cwd ?? sessionStore.getSession(sessionId)?.cwd;
		if (!cwd) return false;
		return hasUncommittedChanges(cwd);
	}

	/**
	 * Switch a session between the two app-level modes. Works whether or not
	 * the session is currently running:
	 *   - Running: tells the SDK to change permissionMode live, then persists
	 *     and broadcasts. SDK call is best-effort — if it throws we still
	 *     persist (worst case: next message-turn applies the new mode).
	 *   - Not running: just persists. Next resume picks up the new mode.
	 *
	 * Pending permission requests are intentionally NOT auto-resolved on
	 * switch — the user can decide on whatever is already on screen.
	 */
	async setMode(sessionId: string, mode: SessionMode): Promise<void> {
		const entry = this.sessions.get(sessionId);
		if (entry) {
			if (entry.session.mode === mode) return;
			entry.session.mode = mode;
			try {
				await entry.queryRef.current?.setPermissionMode(
					sdkPermissionModeFor(mode),
				);
			} catch (err) {
				console.error("[ccw] setPermissionMode failed:", err);
			}
		}
		await sessionStore.updateSession(sessionId, { mode });
		this.send("session:patch", { sessionId, mode });
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

	/**
	 * Fully tear down a running session and wait for the SDK loop to finish
	 * before returning. Use this when the caller needs to be sure no more
	 * messages, status events, or store writes will arrive for this session
	 * (e.g. before deleting the session record).
	 *
	 * Steps:
	 *   1. Ask the SDK to stop in-flight tool/assistant work (interrupt).
	 *   2. End the user-prompt async iterable so the SDK winds down naturally.
	 *   3. Trigger the abort signal so the for-await loop breaks.
	 *   4. Await the runLoop's `done` deferred (resolved in its `finally`).
	 *
	 * Best-effort with a timeout — if the SDK is wedged, we still return so
	 * the caller can proceed with deletion. The store's late-write guards
	 * handle any straggling writes.
	 */
	async cancelAndWait(sessionId: string, timeoutMs = 5000): Promise<void> {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		try {
			await entry.queryRef.current?.interrupt();
		} catch (err) {
			console.error("[ccw] interrupt during cancelAndWait failed:", err);
		}
		entry.finish();
		entry.abort.abort();
		await Promise.race([
			entry.done,
			new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	}

	private async captureDiff(
		cwd: string,
		startCommit: string | undefined,
	): Promise<string | undefined> {
		if (!startCommit) return undefined;
		return getDiffSinceCommit(cwd, startCommit);
	}

	private send(channel: string, payload: unknown) {
		// Drop broadcasts for tombstoned sessions. Late SDK events (status,
		// cancelled, message, patch, done, errored, started) all carry the
		// session id as either `sessionId` or `id` in the payload object.
		// Payloads without a session id (e.g. `permission:resolved` carries
		// only `requestId`) pass through — the renderer needs them to clear
		// its permission queue and they can't resurrect a deleted row.
		if (payload && typeof payload === "object") {
			const p = payload as { sessionId?: unknown; id?: unknown };
			const sid =
				typeof p.sessionId === "string"
					? p.sessionId
					: typeof p.id === "string"
						? p.id
						: undefined;
			if (sid && this.deletedIds.has(sid)) return;
		}
		windows.broadcast(channel, payload);
	}
}
