import {
	deleteSession as sdkDeleteSession,
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
import { accessSync, existsSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	PROVISIONAL_SWEEP_INTERVAL_MS,
	SessionActivity,
	systemSubtype,
} from "./sessionActivity";

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
import {
	isInjectedUserProse,
	isSubagentContent,
	isSubagentProse,
} from "../../shared/claude-sessions/transcript";
import { transcriptHasUuid, waitForUuid } from "./transcriptIndex";
import {
	assistantStreamModel,
	identityMatches,
	parseModelIdentity,
} from "../../shared/claude-sessions/sessionModel";
import { isSidequestId } from "../../shared/claude-sessions/sidequest";
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
 *
 * Final guard: if the resolved directory no longer exists on disk (project
 * folder deleted, renamed, or on an unmounted volume), fall back to
 * `homedir()`. `child_process.spawn` fails with **ENOENT when its `cwd` is
 * missing**, and the SDK reports that as "Claude Code native binary not found
 * at <path>" — pointing at a binary that is perfectly fine and sending anyone
 * debugging it down the wrong path entirely. Same reason `probeSupportedModels`
 * uses `homedir()`: it's the one directory guaranteed to exist.
 */
function resolveEffectiveCwd(session: {
	cwd: string;
	worktreeId?: string;
}): string {
	const preferred = session.worktreeId
		? (worktreesStore.get(session.worktreeId)?.worktreePath ?? session.cwd)
		: session.cwd;
	if (preferred && existsSync(preferred)) return preferred;
	console.warn(
		`[ccw] session cwd does not exist: ${preferred || "(empty)"} — falling back to ${homedir()}`,
	);
	return homedir();
}

interface RunningEntry {
	session: ClaudeSession;
	abort: AbortController;
	pushTurn: (blocks: UserContentBlock[]) => void;
	finish: () => void;
	setIdle: () => Promise<void>;
	queryRef: { current: Query | null };
	// Sidequest sessions: live only in this map, never in the session store,
	// and broadcast on `sidequest:*` channels. Every persistence call site in
	// runLoop and the mutators below is guarded on this flag, because the
	// renderer's `upsertSession` lazy-creates rows from any `session:*`
	// payload — a single leaked broadcast would mint a ghost sidebar entry.
	ephemeral?: boolean;
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

/**
 * `terminal_reason` values that mean "this turn was cut off by a usage
 * limit," as opposed to actually finishing (`completed`), hitting a turn
 * cap (`max_turns`), or any other non-limit stop. Read off the `result`
 * message that closes a turn — see `extractTerminalReason` and its call
 * site in `runLoop`.
 */
const USAGE_LIMIT_TERMINAL_REASONS = new Set<string>([
	"blocking_limit",
	"rapid_refill_breaker",
]);

/**
 * Read `terminal_reason` off a `result` message defensively, as a plain
 * string — same rationale as `extractSdkSessionId`: we spawn the user's
 * global `claude` binary, which routinely runs ahead of the `sdk.d.ts` this
 * app compiles against, so this must tolerate values the local SDK types
 * don't know about yet.
 */
function extractTerminalReason(msg: SDKMessage): string | undefined {
	if (msg.type !== "result") return undefined;
	const reason = (msg as { terminal_reason?: unknown }).terminal_reason;
	return typeof reason === "string" ? reason : undefined;
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

/**
 * Did this message announce that the CLI rejected our `model` option?
 *
 * The CLI does NOT validate `--model` at spawn: `system:init` echoes the
 * bad id verbatim and the process comes up healthy. The first API call
 * then returns 404 and the CLI emits a synthetic assistant message —
 * `message.model === "<synthetic>"`, `is_api_error_message: true`,
 * `error: "model_not_found"` — followed by a `result` with
 * `is_error: true`, `api_error_status: 404`, `terminal_reason: "api_error"`.
 * Verified against claude 2.1.250.
 *
 * `error` is read as an unknown string on purpose: the bundled SDK's
 * `SDKAssistantMessageError` union does not list "model_not_found" yet.
 * The CLI is ahead of our types — the same asymmetry that produced the
 * "fable" incident (see resolveClaudeBinary above). Widening this to any
 * 404 or any `terminal_reason: "api_error"` would swallow unrelated
 * failures, so it is deliberately narrow: a false negative just leaves
 * today's behaviour (the session errors/shows the CLI's message), a false
 * positive would silently discard the user's model choice.
 */
function isModelRejection(msg: SDKMessage): boolean {
	if (msg.type !== "assistant") return false;
	return (msg as unknown as { error?: unknown }).error === "model_not_found";
}

function sdkPermissionModeFor(mode: SessionMode): "plan" | "acceptEdits" {
	return mode === "plan" ? "plan" : "acceptEdits";
}

// Pasted links are near-useless as names — a single URL can eat the whole 60-char
// budget and truncate away the part the user actually wrote. Strip them before
// truncating so the prose survives. Only scheme-bearing URLs (`something://…`)
// count: bare hosts like `foo.io` are too easy to confuse with filenames.
function stripUrls(text: string): string {
	return (
		text
			// `[label](https://…)` keeps its label — that text is the human part.
			.replace(/\[([^\]]+)\]\([a-z][a-z0-9+.-]*:\/\/[^)\s]*\)/gi, "$1")
			// Stop at closing wrappers/quotes rather than running to the next
			// space, so `(https://x.com)` doesn't leave a widowed `(` behind.
			.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]>"'`]*/gi, " ")
			// The now-empty wrapper itself: `see (<>)` → `see`, `quote "" ` → `quote`.
			.replace(/[([<]\s*[)\]>]/g, " ")
			.replace(/(["'`])\s*\1/g, " ")
	);
}

// Only the first line becomes the title — a multi-line message shouldn't
// have all its lines run together into one long, run-on name. Lines are
// scanned in order (raw alongside their URL-stripped counterpart) and the
// first one that still has content wins, so a first line that's *just* a
// link is skipped in favor of whatever comes after it, instead of the raw
// URL becoming the name.
function deriveTitle(text: string, maxLen = 60): string {
	const rawLines = text.split("\n");
	const strippedLines = stripUrls(text).split("\n");

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i].replace(/\s+/g, " ").trim();
		const stripped = (strippedLines[i] ?? rawLines[i])
			.replace(/\s+/g, " ")
			.trim();
		if (!stripped) continue; // blank line, or a line that was only a URL

		let title = stripped;
		// Only tidy when a URL was actually removed from this line, so
		// URL-free lines derive byte-for-byte the same name they always have.
		if (stripped !== raw) {
			title = stripped
				// Punctuation the URL used to sit in front of: `did you see ?`.
				.replace(/\s+([?!.,;:])/g, "$1")
				// Separators the URL was sitting between: `check out , then run`.
				// Leaves `?`/`!`/`.` alone so a question keeps reading like one.
				.replace(/^[\s,;:·|/\\–—-]+|[\s,;:·|/\\–—-]+$/g, "")
				.trim();
			if (!title) continue; // nothing left once the URL is gone
		}

		return title.length <= maxLen ? title : title.slice(0, maxLen - 1) + "…";
	}
	return "";
}

function firstTextFromBlocks(blocks: UserContentBlock[]): string {
	for (const b of blocks) {
		if (b.type === "text" && b.text.trim().length > 0) return b.text;
	}
	return "";
}

/**
 * How long to let a sidequest's SDK loop wind down before unlinking its
 * transcript anyway, and how long the whole quit-time sweep may take. Both are
 * ceilings on housekeeping — exceeding them leaves an orphaned JSONL in
 * `~/.claude/projects`, which is untidy but harmless, and is strictly better
 * than a CLI that won't die holding the app open.
 */
const TRANSCRIPT_TEARDOWN_TIMEOUT_MS = 3000;
const SIDEQUEST_SWEEP_TIMEOUT_MS = 4000;

/**
 * Run `fn`, and on failure run it once more after a short delay. For racing
 * the CLI's asynchronous JSONL flush — see the call site in `forkFrom`.
 */
async function retryOnce<T>(fn: () => Promise<T>, delayMs = 300): Promise<T> {
	try {
		return await fn();
	} catch {
		await new Promise((r) => setTimeout(r, delayMs));
		return await fn();
	}
}

/**
 * Truncate a transcript to (and including) the message at `msgIndex`, plus the
 * turn-end `result` message that immediately follows when present.
 *
 * The SDK emits exactly one `result` per turn, carrying that turn's token
 * usage; without it a forked session's SessionTokenBar would read 0
 * (single-turn parent) or miss the latest turn's cost. Result messages render
 * invisibly, so including it doesn't change the visible chat history.
 */
function truncateThrough(
	messages: SessionMessage[],
	msgIndex: number,
): SessionMessage[] {
	let endIndex = msgIndex + 1;
	if (endIndex < messages.length && messages[endIndex].role === "result") {
		endIndex++;
	}
	return messages.slice(0, endIndex);
}

/**
 * The in-memory record backing a live sidequest. Sidequests have no row in
 * `claude_sessions.json`, so this is the only place main can answer "what has
 * this branch actually said?" — which `promoteSidequest` needs in order to
 * mint a real session out of one.
 */
interface SidequestRun {
	/** The same object runLoop mutates, so `sdkSessionId` stays current. */
	session: ClaudeSession;
	parentSessionId: string;
	/** The parent assistant message this branched from. */
	forkMessageId: string;
	/** Every message broadcast on `sidequest:message`, in order, same ids. */
	messages: SessionMessage[];
	/**
	 * Set once this sidequest has been promoted into a persisted session. The
	 * promoted session's inherited messages still carry the *sidequest's*
	 * `session_id`, so its SDK transcript has to outlive the discard that
	 * would normally delete it — see `discardSidequest`.
	 */
	promoted?: boolean;
}

export class SessionManager {
	private sessions = new Map<string, RunningEntry>();
	// Tombstones for deleted sessions. Once an id lands here, `send()` drops
	// any subsequent broadcast referring to it so leaked SDK events from a
	// still-winding-down loop can't resurrect the row in any renderer
	// (which lazy-creates entries from upsert payloads). UUIDs are random,
	// so we don't need to evict — one entry per delete per process lifetime.
	private deletedIds = new Set<string>();
	// parentSessionId -> sidequestId. At most one sidequest per main session;
	// purely in-memory, so sidequests die with the process by design.
	private sidequests = new Map<string, string>();
	// sidequestId -> everything `promoteSidequest` needs to turn an ephemeral
	// branch into a real session.
	//
	// Deliberately NOT stored on the `RunningEntry`: runLoop's `finally` does
	// `this.sessions.delete(id)`, so a sidequest whose CLI died would lose its
	// transcript here while the renderer keeps rendering it — and a dead
	// sidequest is exactly when someone wants to salvage the conversation.
	// Cleared by `discardSidequest`, so it's bounded at one entry per parent.
	private sidequestRuns = new Map<string, SidequestRun>();
	// In-flight `deleteSdkTranscript` calls, so `discardAllSidequests` can wait
	// on deletions that `discardSidequest` otherwise fires and forgets.
	private pendingTranscriptDeletes = new Set<Promise<void>>();

	constructor(private broker: PermissionBroker) {}

	/**
	 * Mark a session id as deleted. After this point, `send()` drops any
	 * broadcast whose payload references the id, regardless of whether the
	 * SDK loop has finished tearing down. Idempotent.
	 */
	markDeleted(id: string): void {
		this.deletedIds.add(id);
	}

	/**
	 * Lift a delete tombstone so `send()` stops dropping broadcasts for the id.
	 * The inverse of `markDeleted`, called by `session:restore` when a deleted
	 * session is undone.
	 *
	 * Safe because the SDK loop that the delete tore down is genuinely gone by
	 * now — `session:delete` awaited the store write and fired
	 * `cancelAndWait` — so lifting the tombstone can't let a stale event from
	 * the *old* loop through. It only re-enables broadcasts for the restored
	 * row, which is exactly what we want: without this, a restored session
	 * would sit in the sidebar unable to ever report status again.
	 */
	unmarkDeleted(id: string): void {
		this.deletedIds.delete(id);
	}

	getSession(id: string): ClaudeSession | undefined {
		return this.sessions.get(id)?.session;
	}

	/**
	 * Apply a rename to the live runtime entry, if the session has one.
	 * Persistence and the `session:patch` broadcast stay with the
	 * `session:rename` IPC handler — this only stops the in-memory copy
	 * going stale, which otherwise shows the pre-rename title in permission
	 * notification subtitles (see `ipc/notifications.ts`). Also locks the
	 * title, mirroring what the handler writes to disk. No-op when the
	 * session isn't currently running.
	 */
	setTitle(sessionId: string, title: string): void {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		entry.session.title = title;
		entry.session.titleLocked = true;
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
			// A name the user typed themselves outranks the derivation, even
			// when an initial prompt is present.
			title: input.titleLocked ? input.title : derivedTitle || input.title,
			titleLocked: input.titleLocked ?? false,
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
			// Authoritative as-is — deliberately NOT `?? appSettings.get()
			// .defaultModel`. The app-wide default is applied when the DRAFT
			// is created (useDraftSessionsStore.createDraft), so it is
			// already baked into `input.model` by the time we get here.
			// Re-applying it here would make `undefined` unrepresentable and
			// silently override a user who explicitly picked "Default" in
			// the draft header on top of a non-default app setting.
			model: input.model,
			// Sidebar group. Membership lives only on this field (no reverse
			// index, nothing to attach), so this single assignment is the
			// whole bookkeeping — same move `fork()` makes below. The
			// `session:started` broadcast carries it to the renderer.
			groupId: input.groupId,
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
	 * Resolve the SDK-side coordinates of a fork point: which transcript uuid
	 * to branch at, and which SDK session actually contains that uuid.
	 *
	 * A transcript uuid is only valid inside the SDK session that minted it:
	 * `forkSession` copies the transcript with *freshly remapped* uuids, while
	 * we copy inherited messages' `content` verbatim. So a message a wrapper
	 * inherited from an ancestor carries the ancestor's uuid, which does not
	 * exist in the wrapper's own `sdkSessionId` — branching it against
	 * `parent.sdkSessionId` fails with "Message X not found in session Y".
	 * Use the session named by the message instead.
	 *
	 * This is correct at any depth: each wrapper's message list is a
	 * prefix-copy of its parent's, so the ancestor's transcript prefix up to
	 * this uuid is content-identical to ours.
	 *
	 * `content` is the raw SDKMessage, so `session_id` is stamped by the SDK
	 * itself (cf. extractSdkSessionId). Locally-synthesised messages have
	 * none; they're never fork targets, but fall back to the parent to be safe.
	 *
	 * Shared by `fork()` (persisted fork) and `startSidequest()` (ephemeral).
	 */
	private resolveForkSource(
		parent: ClaudeSessionFull,
		wrapperMessageId: string,
	): { sdkUuid: string; sourceSdkId: string } {
		if (!parent.sdkSessionId) {
			throw new Error(
				"This session has no SDK session id yet — wait for Claude's first response before forking.",
			);
		}
		const targetMsg = parent.messages.find((m) => m.id === wrapperMessageId);
		if (!targetMsg) throw new Error("Message not found in this session");
		if (targetMsg.role !== "assistant") {
			throw new Error("Can only fork from an assistant message");
		}
		// Subagent traffic carries the *subagent's* uuid, which never appears in
		// the parent transcript — branching it always fails with "No message
		// found with message.uuid". The renderer already filters these out in
		// `isForkableAssistant`, but this is the re-validation point, and every
		// other invariant that predicate relies on is checked here too.
		if (isSubagentContent(targetMsg.content)) {
			throw new Error(
				"Can't fork from a subagent message — pick a top-level reply",
			);
		}
		const sdkMeta = targetMsg.content as {
			uuid?: unknown;
			session_id?: unknown;
		};
		const sdkUuid = sdkMeta.uuid;
		if (typeof sdkUuid !== "string" || sdkUuid.length === 0) {
			throw new Error(
				"This message has no SDK uuid and can't be used as a fork point",
			);
		}
		const messageSdkId = sdkMeta.session_id;
		const sourceSdkId =
			typeof messageSdkId === "string" && messageSdkId.length > 0
				? messageSdkId
				: parent.sdkSessionId;
		return { sdkUuid, sourceSdkId };
	}

	/**
	 * Like `resolveForkSource`, but guaranteed (as far as the disk can tell) to
	 * name a uuid the resuming CLI will actually find.
	 *
	 * `resolveForkSource` reads our *in-memory* copy of the SDK stream, while
	 * the CLI resolves `--resume-session-at` against the JSONL it writes
	 * asynchronously. The sidequest panel branches at the newest assistant
	 * reply, so those two views disagree for a beat after every message lands —
	 * and the CLI's response to a miss is to exit 1, leaving a dead sidequest.
	 *
	 * So: wait briefly for the flush, and if the uuid still isn't there, walk
	 * back to the newest message that *is*. Branching one reply earlier costs
	 * the user nothing they can see; an error banner costs them their draft.
	 *
	 * Only used by `startSidequest`. `forkFrom` races the same flush but can
	 * guard it with a plain `retryOnce` around `sdkForkSession`, because there
	 * the failure is a rejected promise rather than a CLI that exits inside the
	 * SDK loop.
	 */
	private async resolveViableForkSource(
		parent: ClaudeSessionFull,
		wrapperMessageId: string,
	): Promise<{ sdkUuid: string; sourceSdkId: string }> {
		// Throws with a user-facing message when the parent has no SDK session
		// id yet or the target isn't a forkable assistant message.
		const preferred = this.resolveForkSource(parent, wrapperMessageId);

		if (await waitForUuid(preferred.sourceSdkId, preferred.sdkUuid)) {
			return preferred;
		}

		// One read per transcript for the whole walk — these files run to
		// megabytes, and ancestor routing means the candidates may span more
		// than one of them.
		const cache = new Map<string, Set<string> | null>();
		const idx = parent.messages.findIndex((m) => m.id === wrapperMessageId);
		for (let i = idx - 1; i >= 0; i--) {
			const m = parent.messages[i];
			if (m.role !== "assistant") continue;
			if (isSubagentContent(m.content)) continue;
			let candidate: { sdkUuid: string; sourceSdkId: string };
			try {
				candidate = this.resolveForkSource(parent, m.id);
			} catch {
				continue; // no uuid on this one — keep walking back
			}
			if (
				(await transcriptHasUuid(
					candidate.sourceSdkId,
					candidate.sdkUuid,
					cache,
				)) !== false
			) {
				console.warn(
					`[ccw] sidequest fork point ${preferred.sdkUuid} not in transcript ${preferred.sourceSdkId}; branching at ${candidate.sdkUuid} instead`,
				);
				return candidate;
			}
		}

		throw new Error(
			"Couldn't find a branch point in this session's Claude transcript yet — wait for the current reply to finish and try again.",
		);
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
		return this.forkFrom(parent, wrapperMessageId);
	}

	/**
	 * The body of `fork()`, taking the parent as a value rather than reading it
	 * from the store — so `promoteSidequest` can pass a synthesized parent
	 * assembled from a live sidequest, which has no store row at all.
	 */
	private async forkFrom(
		parent: ClaudeSessionFull,
		wrapperMessageId: string,
		opts?: { title?: string; groupId?: string },
	): Promise<ClaudeSession> {
		if (!parent.sdkSessionId) {
			throw new Error(
				"This session has no SDK session id yet — wait for Claude's first response before forking.",
			);
		}

		const msgIndex = parent.messages.findIndex(
			(m) => m.id === wrapperMessageId,
		);
		if (msgIndex < 0) throw new Error("Message not found in this session");
		const { sdkUuid, sourceSdkId } = this.resolveForkSource(
			parent,
			wrapperMessageId,
		);

		const truncated = truncateThrough(parent.messages, msgIndex);
		const newTitle = opts?.title ?? `${parent.title} (fork)`;

		// No `dir` option on purpose: when omitted the SDK searches *all* project
		// directories for the session file. That's load-bearing here — the ancestor
		// may have run under a different project key than resolveEffectiveCwd()
		// resolves to today (e.g. a worktree since removed from the registry).
		let newSdkId: string;
		try {
			// One retry: `sdkForkSession` reads the transcript from disk, but the
			// CLI writes it asynchronously from the stream we've already relayed
			// to the renderer. Forking a reply the instant it lands — routine in
			// the sidequest panel, where the message you just read is the one you
			// click — can beat the flush. Only the not-yet-there failure is worth
			// retrying; a genuinely missing transcript fails the same way twice.
			({ sessionId: newSdkId } = await retryOnce(() =>
				sdkForkSession(sourceSdkId, {
					upToMessageId: sdkUuid,
					title: newTitle,
				}),
			));
		} catch (err) {
			// Don't retry against parent.sdkSessionId — that's the bug this routing
			// fixes, and if it ever succeeded it would branch from an unrelated
			// point in an unrelated conversation.
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Couldn't fork from Claude session ${sourceSdkId} — its transcript in ~/.claude may have been deleted or cleared. (${detail})`,
			);
		}

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
			// A fork of a deliberately-named session keeps that intent. Forks
			// never hit the derive path anyway (their transcript always
			// contains a user message), so this is purely about downstream
			// renames and clarity.
			titleLocked: parent.titleLocked,
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
			// grouped session lands next to its parent in the sidebar. A
			// promoted sidequest overrides this with the *main* session's
			// group, since the synthetic parent has none of its own.
			groupId: opts?.groupId ?? parent.groupId,
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
			titleLocked: newSessionFull.titleLocked,
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

	/**
	 * Start a **sidequest**: an ephemeral fork of a main session, branched at
	 * one of its assistant messages, for asking throw-away questions without
	 * polluting the main thread's context.
	 *
	 * Nothing reaches `claude_sessions.json` — no `sessionStore.createSession`,
	 * and `runLoop` runs with `ephemeral: true`, so the sidebar, inbox and
	 * badges never learn a sidequest exists. App-side state is the
	 * `RunningEntry` in `this.sessions`, the parent→sidequest link in
	 * `this.sidequests`, and the transcript in `this.sidequestRuns` — all
	 * in-memory, all gone on quit.
	 *
	 * The SDK side *is* persisted, though: the branch gets a real transcript in
	 * `~/.claude/projects`, because `promoteSidequest` forks from it and
	 * `sdkForkSession` can only read from disk. `discardSidequest` deletes that
	 * transcript again, so an un-promoted sidequest still leaves no trace.
	 *
	 * Because the entry lives in the same map as normal sessions,
	 * `pushUserMessage`, `interrupt`, `setModel` and `supportedModels` all
	 * work on a sidequest id for free.
	 *
	 * Idempotent w.r.t. an existing sidequest: any current one for this parent
	 * is discarded first, which is exactly the "re-fork at a new highlight"
	 * behaviour the renderer wants.
	 */
	async startSidequest(input: {
		sidequestId: string;
		parentSessionId: string;
		forkMessageId: string;
	}): Promise<ClaudeSession> {
		const { sidequestId, parentSessionId, forkMessageId } = input;

		const parent = sessionStore.getSession(parentSessionId);
		if (!parent) throw new Error("Parent session not found");
		// Preflighted against the on-disk transcript: the CLI we're about to
		// spawn exits 1 if it can't find this uuid, and that failure arrives
		// asynchronously (see the `void this.runLoop` below), so it can't be
		// reported back to the caller — only as a dead panel a second later.
		const { sdkUuid, sourceSdkId } = await this.resolveViableForkSource(
			parent,
			forkMessageId,
		);

		await this.discardSidequest(parentSessionId);

		const session: ClaudeSession = {
			id: sidequestId,
			title: `Sidequest: ${parent.title}`,
			titleLocked: true,
			prompt: "",
			cwd: parent.cwd,
			status: "idle",
			createdAt: Date.now(),
			branch: parent.branch,
			startCommit: parent.startCommit,
			// Permission handling is inherited from the parent: same mode, same
			// broker, and the renderer routes the resulting permission cards
			// into the sidequest panel by session id.
			mode: parent.mode,
			model: parent.model,
			// Same on-disk checkout as the parent, so tools see the same tree.
			worktreeId: parent.worktreeId,
		};

		// Both maps are set *after* discardSidequest above, which clears them.
		this.sidequests.set(parentSessionId, sidequestId);
		this.sidequestRuns.set(sidequestId, {
			session,
			parentSessionId,
			forkMessageId,
			messages: [],
		});

		// Don't await — runLoop runs the SDK loop until it ends. Its
		// synchronous prologue registers the entry and emits
		// `sidequest:started` before the first await.
		void this.runLoop({
			session,
			cwd: resolveEffectiveCwd(parent),
			initialTurns: [],
			resumeSdkSessionId: sourceSdkId,
			resumeSessionAt: sdkUuid,
			ephemeral: true,
			parentSessionId,
		});

		return session;
	}

	/**
	 * Discard a parent's sidequest: abort its SDK loop, cancel any permission
	 * prompts it left hanging, tombstone its id so late SDK events can't
	 * repopulate the renderer's panel after the user cleared it, and delete the
	 * branch's SDK transcript. No-op when the parent has no sidequest.
	 */
	async discardSidequest(parentSessionId: string): Promise<void> {
		const sidequestId = this.sidequests.get(parentSessionId);
		if (!sidequestId) return;
		this.sidequests.delete(parentSessionId);
		const run = this.sidequestRuns.get(sidequestId);
		this.sidequestRuns.delete(sidequestId);

		// Broadcast before tombstoning: this payload carries no `sessionId`/`id`
		// key, so `send()` lets it through either way, but ordering keeps the
		// renderer's clear instantaneous.
		this.send("sidequest:discarded", { parentSessionId, sidequestId });
		this.broker.cancelAllForSession(sidequestId, "Sidequest discarded");
		this.markDeleted(sidequestId);
		// Teardown can take seconds if the CLI is mid-tool; don't make the
		// caller (and the user's next keystroke) wait on it.
		void this.cancelAndWait(sidequestId);

		// Reclaim the branch's transcript in ~/.claude/projects. Sidequests run
		// with `forkSession: true`, which copies the whole parent transcript
		// prefix into a new file on *every* Cmd+S re-fork — left alone that
		// grows without bound and clutters the user's `claude --resume` picker.
		//
		// Except when it was promoted: the promoted session's inherited
		// messages still carry this sidequest's `session_id`, so forking again
		// inside it routes back here (see resolveForkSource). Deleting the file
		// would self-inflict the exact "transcript may have been deleted or
		// cleared" failure that function's doc warns about.
		const sdkId = run?.session.sdkSessionId;
		if (sdkId && !run?.promoted) {
			// Tracked rather than plain-`void`ed so the quit sweep below can
			// actually wait for it — otherwise `app.exit(0)` cuts it off.
			const p: Promise<void> = this.deleteSdkTranscript(
				sdkId,
				sidequestId,
			).finally(() => this.pendingTranscriptDeletes.delete(p));
			this.pendingTranscriptDeletes.add(p);
		}
	}

	/**
	 * Best-effort removal of an SDK transcript from `~/.claude/projects`. No
	 * `dir` on purpose — the SDK then searches every project directory, the
	 * same reason `sdkForkSession` omits it in `forkFrom`.
	 *
	 * Deliberately never throws: this is housekeeping, and failing it should
	 * not turn a Clear into a visible error. Gives the SDK loop a moment to
	 * wind down first (the CLI still has the file open, and could recreate it
	 * after an unlink), but never blocks on it — a wedged CLI must not be able
	 * to hang the quit sweep below.
	 */
	private async deleteSdkTranscript(
		sdkSessionId: string,
		wrapperId: string,
	): Promise<void> {
		try {
			const done = this.sessions.get(wrapperId)?.done;
			if (done) {
				await Promise.race([
					done,
					new Promise((r) => setTimeout(r, TRANSCRIPT_TEARDOWN_TIMEOUT_MS)),
				]);
			}
			await sdkDeleteSession(sdkSessionId);
		} catch (err) {
			console.error(
				`[ccw] failed to delete sidequest SDK transcript ${sdkSessionId}:`,
				err,
			);
		}
	}

	/**
	 * Discard every live sidequest and wait for their SDK transcripts to be
	 * reclaimed. Called on quit: `discardSidequest` alone fires the deletion
	 * as a floating promise, which the shutdown sequence's `app.exit(0)` would
	 * cut off, leaking one full transcript copy per open sidequest per run.
	 *
	 * Bounded rather than thorough — an unreachable CLI must never be able to
	 * hold the app open. Anything missed is an orphan in `~/.claude/projects`,
	 * which is untidy but harmless.
	 */
	async discardAllSidequests(): Promise<void> {
		const parents = [...this.sidequests.keys()];
		if (parents.length === 0) return;
		const sweep = (async () => {
			await Promise.all(parents.map((p) => this.discardSidequest(p)));
			// discardSidequest only *starts* the transcript deletions.
			await Promise.all([...this.pendingTranscriptDeletes]);
		})();
		await Promise.race([
			sweep.catch((err) =>
				console.error("[ccw] sidequest quit sweep failed:", err),
			),
			new Promise((r) => setTimeout(r, SIDEQUEST_SWEEP_TIMEOUT_MS)),
		]);
	}

	/**
	 * Promote a sidequest into a real, persisted session: the Fork action in
	 * the sidequest panel's message menu.
	 *
	 * A sidequest is already a fork, so "fork" here can't mean what it means in
	 * the main chat. It means *keep this* — mint a persisted session carrying
	 * the conversation through `wrapperMessageId` and leave it live so the user
	 * can continue in it.
	 *
	 * The synthesized parent's transcript is the main thread's history up to
	 * the branch point followed by the sidequest's own turns. That ordering
	 * isn't cosmetic: it makes the promoted session's *visible* history match
	 * its actual *SDK* context, since the sidequest was itself an SDK fork at
	 * exactly that point.
	 *
	 * The sidequest itself survives — same "parent untouched" contract as
	 * `fork()`, and discarding would silently drop the tail when the user
	 * promoted from a non-final message.
	 */
	async promoteSidequest(
		parentSessionId: string,
		wrapperMessageId: string,
	): Promise<ClaudeSession> {
		// Resolve through the parent link rather than trusting a sidequest id
		// from the renderer: a Fork click that raced a Cmd+S re-fork would
		// otherwise promote a torn-down branch whose transcript we just deleted.
		const sidequestId = this.sidequests.get(parentSessionId);
		const run = sidequestId
			? this.sidequestRuns.get(sidequestId)
			: undefined;
		if (!run) {
			throw new Error(
				"This sidequest is no longer available — start a new one and try again.",
			);
		}
		if (run.messages.length === 0 || !run.session.sdkSessionId) {
			throw new Error(
				"This sidequest hasn't started yet — send a message before forking it into a session.",
			);
		}

		// May be undefined if the main session was deleted out from under a
		// still-running sidequest. Rare (delete/archive both discard first), but
		// the promotion is still worth completing on the sidequest turns alone.
		const realParent = sessionStore.getSession(parentSessionId);
		const forkIndex =
			realParent?.messages.findIndex((m) => m.id === run.forkMessageId) ?? -1;
		const prefix =
			realParent && forkIndex >= 0
				? truncateThrough(realParent.messages, forkIndex)
				: [];

		// Not re-id'd here — forkFrom re-ids every copied message anyway.
		const synthetic: ClaudeSessionFull = {
			...run.session,
			messages: [...prefix, ...run.messages],
		};

		// `wrapperMessageId` is always in the sidequest half, so forkFrom's
		// truncation yields prefix + sidequest-through-the-click. And
		// resolveForkSource prefers the target message's own `session_id` over
		// `parent.sdkSessionId` — which is what routes the SDK fork at the
		// sidequest's own branch rather than the main thread's. Don't
		// "simplify" that preference away.
		const next = await this.forkFrom(synthetic, wrapperMessageId, {
			title: `${realParent?.title ?? "Sidequest"} (sidequest)`,
			groupId: realParent?.groupId,
		});
		// Now load-bearing for discardSidequest's transcript cleanup.
		run.promoted = true;
		return next;
	}

	getSidequestId(parentSessionId: string): string | undefined {
		return this.sidequests.get(parentSessionId);
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
			titleLocked: persisted.titleLocked,
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
		/** Branch the resumed transcript at this SDK message uuid. Sidequests only. */
		resumeSessionAt?: string;
		/**
		 * Ephemeral (sidequest) run: nothing is written to the session store and
		 * every broadcast goes out on `sidequest:*` instead of `session:*`, so
		 * the sidebar/inbox/badges never learn this session exists.
		 */
		ephemeral?: boolean;
		/** Owning main session, echoed in the `sidequest:started` payload. */
		parentSessionId?: string;
	}): Promise<void> {
		const { session, cwd } = cfg;
		const id = session.id;
		const persist = !cfg.ephemeral;
		// `session:foo` for normal runs, `sidequest:foo` for ephemeral ones.
		const ch = (name: string) =>
			cfg.ephemeral ? `sidequest:${name}` : `session:${name}`;

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
		// Lives in `./sessionActivity` so it can be replayed offline against
		// captured transcripts (this module imports electron; that one must
		// not). See `scripts/replay-activity.ts` — that harness is the only
		// real test this logic has, because the failure it guards against is
		// CLI-build-dependent and doesn't reproduce on every machine.
		//
		// `onChange` is an arrow rather than `syncStatus` itself so the
		// reference resolves at call time, after the const below is initialized.
		const activity = new SessionActivity({
			// Seeded from initialTurns: `run()` pre-sets status to "running"
			// when the session was created with a prompt, and that turn is
			// pushed straight into `turns` rather than via pushTurnWithStatus.
			initiallyActive: cfg.initialTurns.length > 0,
			onChange: () => syncStatus(),
		});

		// The single writer of session.status for the lifetime of this loop.
		// SessionActivity deliberately never dedupes its own notifications —
		// the comparison against `session.status` lives here, which is what
		// lets status self-heal after the terminal-state early-return below.
		const syncStatus = () => {
			// Only "running" and "idle" are ours. Once the loop has moved the
			// session to a terminal state (done/cancelled/errored), a late
			// message must not resurrect it.
			if (session.status !== "running" && session.status !== "idle") return;
			const next = activity.isActive ? "running" : "idle";
			if (session.status === next) return;
			session.status = next;
			const d = activity.debug;
			console.log(
				`[session ${id}] ${next} (turn=${d.turn} bg=${d.bg} prov=${d.prov})`,
			);
			this.send(ch("status"), { sessionId: id, status: next });
			if (persist) void sessionStore.updateSession(id, { status: next });
		};

		/** Stays async so `interrupt()` and `RunningEntry` are unchanged. */
		const setIdle = async () => {
			activity.hardStop();
			syncStatus();
		};

		const pushTurnWithStatus = (blocks: UserContentBlock[]) => {
			pushTurn(blocks);
			activity.noteUserTurn();
			syncStatus();
		};

		// When the turn currently being served was handed to the SDK. Read by
		// the model-sync check below: `setModel` only takes effect from the
		// *next* turn, so assistant messages belonging to a turn that was
		// already in flight when the user switched still carry the old model
		// and must not be mistaken for evidence that the switch was ignored.
		// Seeded to "now" because the spawn itself applied `session.model`.
		let turnStartedAt = Date.now();

		// The blocks most recently handed to the SDK. `userStream` SHIFTS
		// turns off `turns`, so a turn killed by a model rejection (see the
		// fallback below) is otherwise unrecoverable — this copy is what
		// gets re-sent.
		let lastTurnBlocks: UserContentBlock[] | null = null;
		// Model id that was rejected, latched between the assistant error
		// message and the `result` that closes that turn (where the
		// fallback actually acts).
		let rejectedModel: string | null = null;
		// One automatic fallback per run. If the CLI's own default ALSO
		// fails (expired auth, org policy), a second attempt would just
		// re-push the turn forever.
		let modelFallbackUsed = false;

		async function* userStream(): AsyncIterable<SDKUserMessage> {
			while (true) {
				while (turns.length > 0) {
					const blocks = turns.shift();
					if (!blocks) continue;
					turnStartedAt = Date.now();
					lastTurnBlocks = blocks;
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
			ephemeral: cfg.ephemeral,
		});
		this.send(
			ch("started"),
			cfg.parentSessionId
				? { ...session, parentSessionId: cfg.parentSessionId }
				: session,
		);

		let sdkIdCaptured = !!session.sdkSessionId;
		let cliVersionLogged = false;
		let sweepTimer: NodeJS.Timeout | null = null;
		// `terminal_reason` off the most recent `result` message, used only
		// when the loop exits cleanly (no abort, no thrown error) to tell a
		// usage-limit cutoff apart from an actual finish. See `syncStatus`'s
		// sibling decision below and `USAGE_LIMIT_TERMINAL_REASONS`.
		let lastTerminalReason: string | undefined;

		try {
			// Armed inside the try so the finally below is guaranteed to clear
			// it. Expires provisional background tasks whose closing event never
			// arrived; a message-driven sweep alone can't cover that, since the
			// stream is silent in exactly the case this exists for.
			sweepTimer = setInterval(
				() => activity.tick(),
				PROVISIONAL_SWEEP_INTERVAL_MS,
			);
			sweepTimer.unref?.();

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
				// Sidequest: branch the resumed transcript at a specific message
				// and fork it into its own SDK session, leaving the parent's
				// untouched.
				//
				// The branch *is* persisted to ~/.claude/projects (no
				// `persistSession: false`), even though the sidequest is
				// ephemeral everywhere else. `sdkForkSession` can only read a
				// transcript from disk, so promoting a sidequest into a real
				// session (promoteSidequest) is impossible without it.
				// discardSidequest deletes the file again, so an un-promoted
				// sidequest still leaves nothing behind.
				...(cfg.resumeSessionAt
					? { resumeSessionAt: cfg.resumeSessionAt }
					: {}),
				...(cfg.ephemeral ? { forkSession: true } : {}),
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

				const terminalReason = extractTerminalReason(msg);
				if (terminalReason) lastTerminalReason = terminalReason;

				// Fold into the running/idle model before anything else — the
				// status flip should not wait on the persist/broadcast path,
				// and some of the messages that drive it are dropped below.
				activity.apply(msg);

				// ── Model rejection → fall back to the CLI default ──────────
				// Detect on the synthetic assistant error, ACT on the `result`
				// that closes the turn: acting immediately would queue the
				// retry while the CLI is still winding down the failed turn.
				// Placed here (before every `continue` below) so no filter can
				// eat the detection, and after `activity.apply` so the
				// `result` has already parked activity at idle before this
				// flips it back to running.
				if (
					!modelFallbackUsed &&
					rejectedModel === null &&
					session.model !== undefined &&
					isModelRejection(msg)
				) {
					rejectedModel = session.model;
				}

				if (rejectedModel !== null && msg.type === "result") {
					const rejected = rejectedModel;
					rejectedModel = null;
					// Latch before any await: no second attempt, ever, in this run.
					modelFallbackUsed = true;

					// The user may have re-picked a model between the failure
					// and this result. Their choice outranks our recovery —
					// only clear the value we actually saw rejected.
					if (session.model === rejected) {
						console.warn(
							`[session ${id}] model "${rejected}" rejected by the CLI — falling back to the CLI default`,
						);
						session.model = undefined;
						session.modelChangedAt = Date.now();
						if (persist) {
							void sessionStore.updateSession(id, {
								model: undefined,
								modelChangedAt: session.modelChangedAt,
							});
						}
						// Patch so the footer chip and picker both read
						// "Default" instead of a model that never ran. `ch()`
						// keeps a sidequest on `sidequest:patch` — a
						// `session:patch` would mint a ghost sidebar row.
						this.send(ch("patch"), {
							sessionId: id,
							model: undefined,
							modelChangedAt: session.modelChangedAt,
						});
						// Re-point the LIVE query. The CLI process is healthy
						// (only the API call 404'd), so this is a control
						// request, not a respawn: sdkSessionId, the
						// transcript, and `session:started` are all untouched.
						try {
							await queryRef.current?.setModel(undefined);
						} catch (err) {
							console.error(
								"[ccw] model fallback setModel failed:",
								err,
							);
						}
						// Re-send the turn the rejection ate. The `WithStatus`
						// variant so `activity.noteUserTurn()` flips the
						// session back to "running" — the result just
						// processed parked it at idle with an unanswered user
						// message. Nothing is persisted or broadcast here:
						// the user's turn is already in the transcript from
						// the original send.
						if (lastTurnBlocks) pushTurnWithStatus(lastTurnBlocks);
						// Deliberately does NOT clear the saved app-wide
						// default (settings.defaultModel): a transient
						// binary-resolution miss (resolveClaudeBinary falling
						// back to a stale bundled binary) must not silently
						// wipe a preference that's valid against the user's
						// normal binary. The console warning above and the
						// flipped chip are the whole signal; the next new
						// session tries the saved default again.
					}
					// Fall through — the CLI's own error message still
					// persists and renders, so the transcript explains why
					// the chip flipped.
				}

				// Which CLI build are we actually talking to? The background-task
				// messages this session's status depends on vary between builds,
				// and the bug this logging exists for reproduces on some machines
				// and not others — without the version a report is undiagnosable.
				if (!cliVersionLogged && systemSubtype(msg) === "init") {
					const ver = (msg as { claude_code_version?: unknown })
						.claude_code_version;
					if (typeof ver === "string") {
						cliVersionLogged = true;
						console.log(`[session ${id}] claude cli ${ver}`);
					}
				}

				if (!sdkIdCaptured) {
					const sid = extractSdkSessionId(msg);
					if (sid) {
						session.sdkSessionId = sid;
						sdkIdCaptured = true;
						if (persist) {
							// Broadcast before persisting: the renderer gates
							// features on `sdkSessionId` (sidequests, `canChat`),
							// and `session:started` fired before this id existed —
							// without a patch the renderer never learns it and
							// those features stay dead until an app reload.
							// Ephemeral sidequests stay inside the `persist`
							// guard: a `session:patch` for a sidequest id would
							// lazy-create a ghost sidebar row via `upsertSession`.
							this.send("session:patch", {
								sessionId: id,
								sdkSessionId: sid,
							});
							void sessionStore.updateSession(id, { sdkSessionId: sid });
						}
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

				// Live-only bookkeeping subtypes: `applyActivity` (above) is their
				// only consumer, nothing ever renders them, and each persisted one
				// costs a broadcast plus a whole-file store rewrite. Delete this
				// block if some future feature wants them back in the transcript.
				if (
					subtype === "task_started" ||
					subtype === "task_updated" ||
					subtype === "task_notification" ||
					subtype === "background_tasks_changed" ||
					subtype === "status"
				) {
					continue;
				}

				// Subagent prose — the Agent tool's prompt echo (arrives as a
				// `user` message) and the subagent's own narration/report text
				// (`assistant`). Both read in the transcript as if the human or
				// top-level Claude said them, so they must never render — and per
				// the same logic as the drops above, never persist. Tool traffic
				// from the same subagent still flows through below: the collapsed
				// tool-run rows need it after a restart. (Renderer-side filters in
				// groupMessages keep OLD store rows hidden.)
				if (
					(msg.type === "user" || msg.type === "assistant") &&
					isSubagentProse(msg as unknown)
				) {
					continue;
				}

				// Machine-injected top-level user prose — Skill instruction
				// expansions, slash-command expansions, compaction summaries,
				// <local-command-stdout>. The SDK never echoes the human's typed
				// turns back through the stream (pushUserMessage persists those
				// locally), so any stream `user` message without tool results is
				// the CLI talking to itself. Interrupt markers are excluded by
				// the predicate — they persist and render as a dim state marker.
				if (msg.type === "user" && isInjectedUserProse(msg as unknown)) {
					continue;
				}

				const sessionMessage: SessionMessage = {
					id: randomUUID(),
					role: roleFromSdkMessage(msg),
					content: msg as unknown,
					ts: Date.now(),
				};

				// Sync the stored override to what the CLI is *actually*
				// running. Nothing else writes `session.model` after a
				// switch, so a CLI-side flip (usage fallback, `/model` inside
				// the session, a changed CLI default) would otherwise leave
				// the stored value describing a model that stopped being used
				// turns ago — and the picker highlighting a row you can no
				// longer select your way back to.
				if (sessionMessage.role === "assistant") {
					const observed = assistantStreamModel(sessionMessage.content);
					// Only trust turns that began *after* the user's last
					// switch. Picking a model mid-response is exactly when a
					// user reaches for the picker ("wait, this is Sonnet") —
					// and the rest of that in-flight turn still streams the
					// old model, which would otherwise instantly clobber the
					// pick they just made.
					if (
						observed !== null &&
						// Only correct an *explicit* override. A session on
						// Default has no override to go stale, and writing the
						// observed id here would quietly convert "follow the
						// CLI default" into a hard pin that outlives the
						// restart — losing the auto-upgrade that picking
						// Default is for. The label and the picker already
						// read the real model straight off the stream, so
						// there is nothing to gain by pinning it.
						session.model !== undefined &&
						turnStartedAt >= (session.modelChangedAt ?? 0) &&
						!identityMatches(
							parseModelIdentity(observed),
							parseModelIdentity(session.model),
						)
					) {
						// Stored verbatim — the "[1m]" suffix included — so a
						// 1M-context session isn't silently downgraded when it
						// respawns (runLoop passes session.model straight to
						// the SDK).
						session.model = observed;
						// `modelChangedAt` is deliberately left alone: it marks
						// *user intent* and gates the pending-label window.
						if (persist) {
							void sessionStore.updateSession(id, { model: observed });
						}
						this.send(ch("patch"), { sessionId: id, model: observed });
					}
				}

				this.send(ch("message"), {
					sessionId: id,
					message: sessionMessage,
				});
				if (persist) {
					void sessionStore.appendMessage(id, sessionMessage);
				} else {
					// A sidequest has no store row, so this map is main's only
					// copy of the transcript — and promoteSidequest needs it to
					// build the promoted session's history. Same object, same
					// id, as the one the renderer just received.
					this.sidequestRuns.get(id)?.messages.push(sessionMessage);
				}
			}

			if (abort.signal.aborted) {
				session.status = "cancelled";
				session.finishedAt = Date.now();
				this.broker.cancelAllForSession(id);
				this.send(ch("cancelled"), {
					sessionId: id,
				});
				if (persist) {
					void sessionStore.updateSession(id, {
						status: "cancelled",
						finishedAt: session.finishedAt,
					});
				}
			} else {
				// A clean loop exit still might not mean the turn actually
				// finished — the SDK reports a usage-limit cutoff as a normal
				// (non-thrown) `result`, distinguishable only by
				// `terminal_reason`. Route that case to its own status so it
				// gets its own badge instead of reading as "done".
				const hitUsageLimit =
					lastTerminalReason !== undefined &&
					USAGE_LIMIT_TERMINAL_REASONS.has(lastTerminalReason);
				session.status = hitUsageLimit ? "usage_limit" : "done";
				session.finishedAt = Date.now();
				this.send(ch(hitUsageLimit ? "usage_limit" : "done"), {
					sessionId: id,
				});
				if (persist) {
					void sessionStore.updateSession(id, {
						status: session.status,
						finishedAt: session.finishedAt,
					});
				}
			}
		} catch (err: unknown) {
			session.status = "errored";
			session.error = err instanceof Error ? err.message : String(err);
			session.finishedAt = Date.now();
			this.broker.cancelAllForSession(id, "Session errored");
			this.send(ch("errored"), {
				sessionId: id,
				error: session.error,
			});
			if (persist) {
				void sessionStore.updateSession(id, {
					status: "errored",
					finishedAt: session.finishedAt,
					error: session.error,
				});
			}
		} finally {
			if (sweepTimer) clearInterval(sweepTimer);
			state.finished = true;
			state.waitForTurn?.();
			this.sessions.delete(id);
			resolveDone();
		}
	}

	pushUserMessage(sessionId: string, blocks: UserContentBlock[]) {
		const entry = this.sessions.get(sessionId);
		if (!entry) throw new Error(`No active session ${sessionId}`);

		// Sidequests: no title derivation (their title is the parent's), no
		// store append, no branch checkpoint. The user turn is broadcast from
		// here rather than appended optimistically in the renderer, so the
		// panel's transcript is fed entirely by `sidequest:*` events.
		if (entry.ephemeral) {
			entry.pushTurn(blocks);
			const userMessage: SessionMessage = {
				id: randomUUID(),
				role: "user",
				content: {
					type: "user",
					message: { role: "user", content: blocks },
				},
				ts: Date.now(),
			};
			// Kept in main's copy of the transcript too — the id has to be the
			// same one the renderer sees, because a Fork click sends a
			// SessionMessage.id back for promoteSidequest to look up.
			this.sidequestRuns.get(sessionId)?.messages.push(userMessage);
			this.send("sidequest:message", {
				sessionId,
				message: userMessage,
			});
			return;
		}

		// If this is the first user input on a session that started without an
		// initial prompt, derive a meaningful title from the message text.
		const persisted = sessionStore.getSession(sessionId);
		const hasNoPriorUserMessage =
			!!persisted && !persisted.messages.some((m) => m.role === "user");
		const hasNoPriorPrompt =
			!entry.session.prompt || entry.session.prompt.trim().length === 0;
		// A name the user chose themselves is never overwritten. Read the flag
		// off the *persisted* row rather than `entry.session` so a rename that
		// landed while this SDK loop was already live is still respected.
		const titleLocked = persisted?.titleLocked === true;
		if (hasNoPriorUserMessage && hasNoPriorPrompt && !titleLocked) {
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
		// Sidequests have no persisted row and no branch chip; writing here
		// would emit a `session:patch` that lazy-creates a ghost sidebar row.
		// Reachable via PermissionBroker.onUserCheckpoint when the user answers
		// a permission prompt inside the sidequest panel.
		if (entry?.ephemeral) return;
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
		// Sidequest: apply to the live query only. Reached from the panel's
		// own mode toggle and from the ExitPlanMode auto-flip in canUseTool.
		// Persisting or broadcasting `session:patch` would mint a ghost sidebar
		// row, so the panel's store is the only record — `sidequest:patch`
		// keeps it in sync. Checked on the id, not just `entry.ephemeral`, so a
		// late call after the SDK loop tore its entry down can't fall through
		// to the persist path below; in that case we also stay silent, because
		// with no live query there is nothing we actually applied to announce.
		if (entry?.ephemeral || isSidequestId(sessionId)) {
			if (entry) this.send("sidequest:patch", { sessionId, mode });
			return;
		}
		await sessionStore.updateSession(sessionId, { mode });
		this.send("session:patch", { sessionId, mode });
	}

	/**
	 * Set (or clear, with `undefined`) the session's model override.
	 * Mirrors `setMode`: live-switches the active SDK query when one exists
	 * (applies from the next turn), and always persists + broadcasts so
	 * inactive sessions pick the model up on their next resume.
	 *
	 * Deliberately NOT short-circuited when the requested model equals the
	 * stored one. `session.model` records what we last *observed or asked
	 * for*, and the CLI can move the live query off it at any time (a
	 * server-side fallback, `/model` typed inside the session). An
	 * equality guard here made re-picking that exact model a silent no-op —
	 * no SDK call, no broadcast — which is precisely the case where the user
	 * most needs the re-assert to land. One redundant control request per
	 * pick is a fair price for "clicking the model always works".
	 *
	 * Sidequests take the same ephemeral branch as `setMode`: the live query is
	 * re-pointed, but the change is announced on `sidequest:patch` instead of
	 * `session:patch`. The renderer's `upsertSession` lazy-creates rows from
	 * any `session:*` payload, so leaking one here would mint a ghost sidebar
	 * entry for a session that has no on-disk record.
	 */
	async setModel(sessionId: string, model: string | undefined): Promise<void> {
		const modelChangedAt = Date.now();
		const entry = this.sessions.get(sessionId);
		if (entry) {
			entry.session.model = model;
			entry.session.modelChangedAt = modelChangedAt;
			try {
				await entry.queryRef.current?.setModel(model);
			} catch (err) {
				console.error("[ccw] setModel failed:", err);
			}
		}
		if (entry?.ephemeral || isSidequestId(sessionId)) {
			if (entry) {
				this.send("sidequest:patch", { sessionId, model, modelChangedAt });
			}
			return;
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
	 *
	 * `sessionId` is optional so the app-settings "Default model" picker
	 * (which has no session to ask) can go straight to the probe — same
	 * path a draft or an idle session already takes.
	 */
	async supportedModels(sessionId?: string): Promise<ModelInfo[]> {
		const live = sessionId
			? this.sessions.get(sessionId)?.queryRef.current
			: undefined;
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
