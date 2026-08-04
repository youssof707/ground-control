import {
	forkSession as sdkForkSession,
	query,
	type ModelInfo,
	type Options,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve which `claude` CLI binary the SDK should spawn.
 *
 * Prefer the user's globally-installed CLI — it's the one they keep
 * up-to-date via the official autoupdater and it knows about any models
 * Anthropic has released since we last shipped. Only fall back to the
 * binary bundled inside our `node_modules` when no global install is
 * present; that fallback binary is frozen at whatever ships in the SDK
 * npm package and can lag behind newer model releases (which is how
 * "fable" ended up rejected in Ground Control despite working in the
 * global CLI).
 *
 * Search order:
 *   1. `CLAUDE_CODE_EXECUTABLE` env var (explicit override).
 *   2. `~/.local/bin/claude` — Anthropic native-installer default.
 *   3. `~/.claude/local/claude` — legacy Claude Code shim path.
 *   4. `PATH` walk for `claude` (`claude.exe` on Windows).
 *   5. Bundled `node_modules/@anthropic-ai/claude-agent-sdk-<plat>-<arch>/claude`.
 *
 * Each candidate is probed with `accessSync(p, X_OK)`; broken symlinks
 * and non-executable entries are skipped silently. The resolved path is
 * memoized and logged once — critical breadcrumb for support/debugging
 * because "which binary am I actually running?" is otherwise invisible.
 */
let cachedClaudeBinary: string | null = null;
function resolveClaudeBinary(): string {
	if (cachedClaudeBinary) return cachedClaudeBinary;

	const isWin = process.platform === "win32";
	const exe = isWin ? "claude.exe" : "claude";

	const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	const root = app
		.getAppPath()
		.replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
	const bundled = join(root, "node_modules", pkg, exe);

	const candidates: string[] = [];
	if (process.env.CLAUDE_CODE_EXECUTABLE) {
		candidates.push(process.env.CLAUDE_CODE_EXECUTABLE);
	}
	candidates.push(join(homedir(), ".local", "bin", exe));
	candidates.push(join(homedir(), ".claude", "local", exe));
	const pathSep = isWin ? ";" : ":";
	for (const dir of (process.env.PATH ?? "").split(pathSep)) {
		if (dir) candidates.push(join(dir, exe));
	}
	candidates.push(bundled);

	for (const p of candidates) {
		try {
			accessSync(p, fsConstants.X_OK);
			cachedClaudeBinary = p;
			console.log(
				`[ground-control] Using Claude binary: ${p}${
					p === bundled ? " (bundled)" : ""
				}`,
			);
			return p;
		} catch {
			/* not executable / doesn't exist — try next */
		}
	}

	cachedClaudeBinary = bundled;
	console.warn(
		`[ground-control] No Claude binary resolved; falling back to bundled path ${bundled}`,
	);
	return bundled;
}

/**
 * Spawn a throw-away Claude query just to enumerate supported models.
 *
 * Used by `supportedModels()` when the target session has no live query
 * (draft, done, errored). The SDK's `supportedModels()` is a control
 * request that "only works in streaming input mode" — so we open a
 * streaming prompt that stays idle (never yields, never resolves) while
 * we ask for the model list, then abort the whole thing.
 *
 * The abort has to happen even on success: without it the CLI subprocess
 * stays alive waiting for the next prompt chunk, leaking a process per
 * picker open. `try/finally` guarantees teardown even if `supportedModels`
 * throws (network flake, CLI crash, etc.).
 *
 * `cwd` is `homedir()` — the probe doesn't need repo context and picking
 * an always-valid path avoids ENOENT if the draft's cwd was deleted.
 */
async function probeSupportedModels(): Promise<ModelInfo[]> {
	const abort = new AbortController();
	// Idle prompt: never yields. The CLI stays running until we abort.
	// Marked async because the SDK expects an AsyncIterable.
	const idlePrompt = (async function* (): AsyncGenerator<
		SDKUserMessage,
		void,
		void
	> {
		await new Promise<void>((resolve) => {
			abort.signal.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
	})();
	const q = query({
		prompt: idlePrompt,
		options: {
			cwd: homedir(),
			pathToClaudeCodeExecutable: resolveClaudeBinary(),
			abortController: abort,
		},
	});
	try {
		return await q.supportedModels();
	} finally {
		abort.abort();
	}
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
	getHeadCommit,
	hasUncommittedChanges,
	switchBranch,
} from "./git";
import * as sessionStore from "../core/store/claude_session";
import * as worktreesStore from "../core/store/worktrees";
import * as rateLimitTracker from "./RateLimitTracker";
import * as windows from "../windows";

/**
 * Resolve the *effective execution cwd* for a session — the directory the
 * SDK query, git branch reads, and `git switch` should target. When a
 * worktree is attached, this is the worktree's checkout path; otherwise
 * it's the session's `cwd` (== baseDir). If the worktree is missing from
 * the registry (externally deleted), fall back to the baseDir so we don't
 * hand the SDK an empty string.
 *
 * Called from every git-op path in SessionManager and from `runLoop`
 * where we pass `cwd:` to the SDK options.
 */
function resolveEffectiveCwd(session: {
	cwd: string;
	worktreeId?: string;
}): string {
	if (!session.worktreeId) return session.cwd;
	const wt = worktreesStore.get(session.worktreeId);
	return wt?.worktreePath ?? session.cwd;
}

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

/**
 * Terminal task states, unioned across the two vocabularies the CLI uses:
 * `task_updated.patch.status` (pending|running|completed|failed|killed) and
 * `task_notification.status` (completed|failed|stopped). One set tolerates
 * either side gaining a value without us having to care which emitted it.
 */
const TERMINAL_TASK_STATUSES = new Set([
	"completed",
	"failed",
	"killed",
	"stopped",
]);

/**
 * Read `subtype` off a system message defensively, as a plain string.
 *
 * We spawn the user's **global** `claude` binary whenever one exists (see
 * `resolveClaudeBinary` above), and that binary is routinely newer than the
 * `sdk.d.ts` we compile against. Subtypes like `background_tasks_changed`
 * and `thinking_tokens` are emitted by the CLI today but aren't in the SDK's
 * `SDKMessage` union at all — so `msg.subtype === "background_tasks_changed"`
 * doesn't even typecheck. Reading through a cast makes an unknown subtype a
 * silent no-op instead of a compile error or a runtime crash.
 */
function systemSubtype(msg: SDKMessage): string | null {
	if (msg.type !== "system") return null;
	const st = (msg as { subtype?: unknown }).subtype;
	return typeof st === "string" ? st : null;
}

/**
 * Task ids from a `background_tasks_changed` snapshot.
 *
 * Returns `null` — not `[]` — when `tasks` isn't an array. That distinction
 * is load-bearing: a malformed or renamed payload must be *ignored*, never
 * mistaken for "no background tasks are running".
 */
function backgroundTaskIds(msg: SDKMessage): string[] | null {
	const tasks = (msg as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) return null;
	const ids: string[] = [];
	for (const t of tasks) {
		const id = (t as { task_id?: unknown })?.task_id;
		if (typeof id === "string") ids.push(id);
	}
	return ids;
}

function taskIdOf(msg: SDKMessage): string | null {
	const id = (msg as { task_id?: unknown }).task_id;
	return typeof id === "string" ? id : null;
}

/**
 * True when a `task_updated` / `task_notification` message means the task is
 * over. Reads both fields — `task_notification` carries `status` at the top
 * level, `task_updated` nests it under `patch`.
 */
function taskStatusIsTerminal(msg: SDKMessage): boolean {
	const m = msg as { status?: unknown; patch?: { status?: unknown } };
	if (typeof m.status === "string" && TERMINAL_TASK_STATUSES.has(m.status)) {
		return true;
	}
	const patched = m.patch?.status;
	return typeof patched === "string" && TERMINAL_TASK_STATUSES.has(patched);
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
		// Resolve execution cwd up front. All git reads below and the SDK
		// query itself target the worktree checkout (when one is attached),
		// not the user's baseDir — so `session.branch`, `startCommit`, and
		// `lastUserMessageBranch` reflect the sandbox the SDK actually lives
		// in, and the BranchChip shows the worktree's live branch.
		const effectiveCwd = resolveEffectiveCwd({
			cwd: input.cwd,
			worktreeId: input.worktreeId,
		});
		const [branch, startCommit, defaultBaseBranch] = await Promise.all([
			getCurrentBranch(effectiveCwd),
			getHeadCommit(effectiveCwd),
			getDefaultBaseBranch(effectiveCwd),
		]);
		const hasInitialPrompt = !!input.prompt && input.prompt.trim().length > 0;
		const derivedTitle = hasInitialPrompt
			? deriveTitle(input.prompt as string)
			: "";
		const session: ClaudeSession = {
			id,
			title: derivedTitle || input.title,
			prompt: input.prompt ?? "",
			// Persist the *baseDir* as `cwd` — the user-facing folder (folder
			// button label, copy-path, reveal-in-Finder). The worktree link
			// lives in `worktreeId`; `resolveEffectiveCwd` derives the SDK
			// execution path from it.
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
			worktreeId: input.worktreeId,
			model: input.model,
		};

		const fullForPersist: ClaudeSessionFull = { ...session, messages: [] };
		try {
			await sessionStore.createSession(fullForPersist);
		} catch (err) {
			console.error("[ccw] failed to persist session:", err);
		}

		// Reverse-index the session on its worktree so we can enforce
		// "no delete while attached" and cascade-detach at delete time.
		// Best-effort: a missing worktree entry (edge case) leaves the
		// session running with a dangling reference — handled the same
		// as an externally-deleted worktree via resolveEffectiveCwd's
		// fallback.
		if (input.worktreeId) {
			try {
				await worktreesStore.attachSession(input.worktreeId, id);
			} catch (err) {
				console.error("[ccw] worktree attachSession failed:", err);
			}
		}

		const initialTurns: UserContentBlock[][] = hasInitialPrompt
			? [[{ type: "text", text: input.prompt as string }]]
			: [];

		await this.runLoop({
			session,
			cwd: effectiveCwd,
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

		// Include the turn-end `result` message that immediately follows the
		// forked-from assistant, when present. The SDK emits exactly one
		// `result` per turn, carrying that turn's token usage; without it the
		// forked session's SessionTokenBar would read 0 (single-turn parent)
		// or miss the latest turn's cost. Result messages are rendered
		// invisibly, so this doesn't change the visible chat history.
		let endIndex = msgIndex + 1;
		if (
			endIndex < parent.messages.length &&
			parent.messages[endIndex].role === "result"
		) {
			endIndex++;
		}
		const truncated = parent.messages.slice(0, endIndex);
		const newTitle = `${parent.title} (fork)`;

		const { sessionId: newSdkId } = await sdkForkSession(parent.sdkSessionId, {
			upToMessageId: sdkUuid,
			title: newTitle,
		});

		// Refresh git context — the working tree may have moved on since the
		// parent started. Reads the *worktree* checkout when the parent is
		// bound to one; child inherits that binding below.
		const effectiveCwd = resolveEffectiveCwd(parent);
		const [branch, startCommit] = await Promise.all([
			getCurrentBranch(effectiveCwd),
			getHeadCommit(effectiveCwd),
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
			// Fork inherits the parent's model override — same conversation,
			// same expectations about which model continues it.
			model: parent.model,
			modelChangedAt: parent.modelChangedAt,
			// Fork inherits parent's worktree binding — both sessions share
			// the same on-disk checkout. The SDK-side sessions are
			// independently forked (separate conversation threads), but tools
			// run in the same sandbox directory.
			worktreeId: parent.worktreeId,
			// Fork also inherits the parent's sidebar group — a fork of a
			// grouped session lands next to its parent in the sidebar.
			groupId: parent.groupId,
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

		// Reverse-index the fork on the shared worktree. Idempotent —
		// safe under any concurrent fork/attach paths.
		if (parent.worktreeId) {
			try {
				await worktreesStore.attachSession(parent.worktreeId, newWrapperId);
			} catch (err) {
				console.error("[ccw] worktree attachSession (fork) failed:", err);
			}
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
			worktreeId: newSessionFull.worktreeId,
			model: newSessionFull.model,
			modelChangedAt: newSessionFull.modelChangedAt,
			groupId: newSessionFull.groupId,
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
		// Target the *worktree* checkout when this session is bound to one.
		const effectiveCwd = resolveEffectiveCwd(persisted);
		const [branch, startCommit] = await Promise.all([
			getCurrentBranch(effectiveCwd),
			getHeadCommit(effectiveCwd),
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
			worktreeId: persisted.worktreeId,
			// Persisted model override survives restarts — runLoop reads it
			// into the SDK options below.
			model: persisted.model,
			modelChangedAt: persisted.modelChangedAt,
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
			cwd: effectiveCwd,
			initialTurns: [],
			resumeSdkSessionId: persisted.sdkSessionId,
		});
	}

	private async runLoop(cfg: {
		session: ClaudeSession;
		cwd: string;
		initialTurns: UserContentBlock[][];
		resumeSdkSessionId: string | undefined;
	}): Promise<void> {
		const { session, cwd } = cfg;
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

		// ── Activity model ───────────────────────────────────────────────────
		// A session is "working" iff EITHER a top-level turn is in flight OR at
		// least one background task is still alive.
		//
		// The second half is the fix for the fable/opus-5 breakage: those CLI
		// builds background their subagents, emit a top-level `result` when the
		// *main* turn ends while the subagents keep running, and then re-enter
		// the loop by themselves (no user turn from us) once one finishes. The
		// old machine only ever armed "running" from a pushed user turn, so
		// every one of those self-resumed stretches rendered as "idle".
		const activity = {
			// Seeded from initialTurns: `run()` pre-sets status to "running"
			// when the session was created with a prompt, and that turn is
			// pushed straight into `turns` rather than via pushTurnWithStatus.
			turnActive: cfg.initialTurns.length > 0,
			backgroundTasks: new Set<string>(),
		};
		// True once *we* have asked for work (initial prompt or a composer
		// message). Guards against a connect-time `init` handshake on a bare
		// resume() lighting the pill with nothing to turn it back off.
		let anyTurnPushed = cfg.initialTurns.length > 0;
		let streamMessagesSeen = 0;

		// The single writer of session.status for the lifetime of this loop.
		const syncStatus = () => {
			// Only "running" and "idle" are ours. Once the loop has moved the
			// session to a terminal state (done/cancelled/errored), a late
			// message must not resurrect it.
			if (session.status !== "running" && session.status !== "idle") return;
			const next =
				activity.turnActive || activity.backgroundTasks.size > 0
					? "running"
					: "idle";
			if (session.status === next) return;
			session.status = next;
			console.log(
				`[session ${id}] ${next} (turn=${activity.turnActive} bg=${activity.backgroundTasks.size})`,
			);
			this.send("session:status", { sessionId: id, status: next });
			void sessionStore.updateSession(id, { status: next });
		};

		/**
		 * Fold one SDK message into the activity model, then re-derive status.
		 *
		 * Note what is deliberately absent: `task_started` is **not** an "add"
		 * source. Backgrounded tasks are always announced by a
		 * `background_tasks_changed` snapshot *before* their `task_started`, so
		 * nothing is missed; foreground subagents emit `task_started` with no
		 * snapshot at all but run inside the main turn, which `turnActive`
		 * already covers. Keeping exactly one event able to *grow* the set is
		 * what makes "this can never get stuck on running" provable.
		 */
		const applyActivity = (msg: SDKMessage) => {
			if (msg.type === "result") {
				// A `result` ends the top-level turn. It does NOT mean the
				// session stopped working — background subagents routinely
				// outlive it. Assuming otherwise *was* the bug.
				activity.turnActive = false;
			} else if (msg.type === "assistant") {
				// Top-level assistant output means the main loop is alive.
				// Defensive re-arm for CLI builds that self-resume without
				// re-emitting `init`. Loose `== null` covers a missing field.
				if (msg.parent_tool_use_id == null) activity.turnActive = true;
			} else {
				switch (systemSubtype(msg)) {
					case "init":
						if (anyTurnPushed || streamMessagesSeen > 1) {
							activity.turnActive = true;
						}
						break;
					case "background_tasks_changed": {
						// Authoritative full snapshot — replace, don't merge.
						const ids = backgroundTaskIds(msg);
						if (ids) {
							activity.backgroundTasks.clear();
							for (const tid of ids) activity.backgroundTasks.add(tid);
						}
						break;
					}
					case "task_updated":
					case "task_notification": {
						if (!taskStatusIsTerminal(msg)) break;
						const tid = taskIdOf(msg);
						// No-op on unknown ids — foreground tasks, which never
						// enter the set, close out through here constantly.
						if (tid) activity.backgroundTasks.delete(tid);
						break;
					}
				}
			}
			syncStatus();
		};

		/**
		 * Hard stop, used by `interrupt()`. Clears BOTH halves of the model:
		 * an interrupt kills in-flight background subagents too, and the CLI
		 * isn't guaranteed to emit their task_updated/task_notification
		 * closures afterwards — so we must not leave ghost ids pinning
		 * "running". Stays async so `interrupt()` and `RunningEntry` are
		 * unchanged.
		 */
		const setIdle = async () => {
			activity.turnActive = false;
			activity.backgroundTasks.clear();
			syncStatus();
		};

		const pushTurnWithStatus = (blocks: UserContentBlock[]) => {
			pushTurn(blocks);
			anyTurnPushed = true;
			activity.turnActive = true;
			syncStatus();
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
				// Per-session model override. Unset = the CLI default model, so
				// we only pass the key when the user picked one explicitly.
				...(session.model ? { model: session.model } : {}),
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

				streamMessagesSeen++;
				logSdkErrors(id, msg);

				// Fold into the running/idle model before anything else — the
				// status flip should not wait on the persist/broadcast path,
				// and some of the messages that drive it are dropped below.
				applyActivity(msg);

				if (!sdkIdCaptured) {
					const sid = extractSdkSessionId(msg);
					if (sid) {
						session.sdkSessionId = sid;
						sdkIdCaptured = true;
						void sessionStore.updateSession(id, { sdkSessionId: sid });
					}
				}

				// High-frequency progress chatter from the newer CLI. Both render
				// as nothing (`groupMessages.isInvisibleMessage` treats every
				// system message as invisible), but each one costs a
				// `session:message` broadcast plus a full JSON.stringify +
				// atomic rewrite of the entire session store. In the existing
				// data that's ~1,260 whole-file rewrites for ~0.5 MB of content
				// nobody can see. Drop them from the transcript the same way
				// `rate_limit_event` is dropped above — after `applyActivity`,
				// which is the only thing that cares about them.
				const subtype = systemSubtype(msg);
				if (subtype === "thinking_tokens" || subtype === "task_progress") {
					continue;
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
			}

			if (abort.signal.aborted) {
				session.status = "cancelled";
				session.finishedAt = Date.now();
				this.broker.cancelAllForSession(id);
				this.send("session:cancelled", {
					sessionId: id,
				});
				void sessionStore.updateSession(id, {
					status: "cancelled",
					finishedAt: session.finishedAt,
				});
			} else {
				session.status = "done";
				session.finishedAt = Date.now();
				this.send("session:done", {
					sessionId: id,
				});
				void sessionStore.updateSession(id, {
					status: "done",
					finishedAt: session.finishedAt,
				});
			}
		} catch (err: unknown) {
			session.status = "errored";
			session.error = err instanceof Error ? err.message : String(err);
			session.finishedAt = Date.now();
			this.broker.cancelAllForSession(id, "Session errored");
			this.send("session:errored", {
				sessionId: id,
				error: session.error,
			});
			void sessionStore.updateSession(id, {
				status: "errored",
				finishedAt: session.finishedAt,
				error: session.error,
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
		const source = entry?.session ?? sessionStore.getSession(sessionId);
		if (!source) return;
		const cwd = resolveEffectiveCwd(source);
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
		const source = entry?.session ?? sessionStore.getSession(sessionId);
		if (!source) return;
		const cwd = resolveEffectiveCwd(source);
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
		const source = entry?.session ?? sessionStore.getSession(sessionId);
		if (!source) throw new Error(`No session ${sessionId}`);
		const cwd = resolveEffectiveCwd(source);
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
		const source = entry?.session ?? sessionStore.getSession(sessionId);
		if (!source) return false;
		const cwd = resolveEffectiveCwd(source);
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

	/**
	 * Set (or clear, with `undefined`) the session's model override.
	 * Mirrors `setMode`: live-switches the active SDK query when one exists
	 * (applies from the next turn), and always persists + broadcasts so
	 * inactive sessions pick the model up on their next resume.
	 */
	async setModel(sessionId: string, model: string | undefined): Promise<void> {
		const modelChangedAt = Date.now();
		const entry = this.sessions.get(sessionId);
		if (entry) {
			if (entry.session.model === model) return;
			entry.session.model = model;
			entry.session.modelChangedAt = modelChangedAt;
			try {
				await entry.queryRef.current?.setModel(model);
			} catch (err) {
				console.error("[ccw] setModel failed:", err);
			}
		}
		await sessionStore.updateSession(sessionId, { model, modelChangedAt });
		this.send("session:patch", { sessionId, model, modelChangedAt });
	}

	/**
	 * List the models the CLI actually supports *right now*. Live-only: no
	 * cache, no hardcoded fallback, no piggyback on other sessions' queries.
	 *
	 * The picker's contract is "what will the binary accept if I pick it?" —
	 * so the answer must come from the same binary that would spawn the
	 * session. If the requested session has a live query we ask it directly;
	 * otherwise (draft, done, errored) we spin up a **transient probe query**
	 * against the same binary purely to enumerate models, then abort it.
	 * That mirrors what `/model` does in a fresh CLI invocation.
	 *
	 * Throws on error rather than returning null/empty — the picker surfaces
	 * the error message instead of quietly showing a stale list.
	 */
	async supportedModels(sessionId: string): Promise<ModelInfo[]> {
		const live = this.sessions.get(sessionId)?.queryRef.current;
		if (live) {
			return await live.supportedModels();
		}
		return await probeSupportedModels();
	}

	/**
	 * Stop in-flight work and drop the session to idle.
	 *
	 * `setIdle` is a hard reset of the activity model (turn + background
	 * tasks), which is what makes this stick: everything the CLI emits in the
	 * post-interrupt tail — `task_updated{killed}`, `task_notification
	 * {stopped}`, `result error_during_execution` — is either shrink-only or
	 * clears `turnActive`, so none of it can flip the session back to running.
	 */
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
