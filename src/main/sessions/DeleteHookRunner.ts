import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { BabysitConfig } from "../../shared/claude-sessions/babysit";
import type { SessionMessage } from "../../shared/schemas/claude_session";
import { describeError, logActivity } from "../activityLog";
import { decideWithConfig } from "./Babysitter";
import { withTimeout, type SessionManager } from "./SessionManager";

const DELETE_HOOK_TIMEOUT_MS = 5 * 60_000;
const TEARDOWN_TIMEOUT_MS = 10_000;
const HOOK_DENY_MESSAGE = "Session is being deleted";
const KEPT_TRANSCRIPTS = 20;

type HookOutcome = "completed" | "timed-out" | "aborted";

interface RunningHook {
	worktreeId?: string;
	babysit?: BabysitConfig;
	abort: AbortController;
	failure: Promise<string | null>;
}

export class DeleteHookRunner {
	private hooks = new Map<string, RunningHook>();
	private transcripts = new Map<string, SessionMessage[]>();

	constructor(private manager: SessionManager) {}

	isRunning(sessionId: string): boolean {
		return this.hooks.has(sessionId);
	}

	start(
		sessionId: string,
		opts: { prompt: string; worktreeId?: string; babysit?: BabysitConfig },
	): void {
		const abort = new AbortController();
		const hook: RunningHook = {
			worktreeId: opts.worktreeId,
			babysit: opts.babysit,
			abort,
			failure: Promise.resolve(null),
		};
		this.hooks.set(sessionId, hook);
		this.keepTranscript(sessionId, this.manager.tapTranscript(sessionId));
		hook.failure = this.run(sessionId, opts.prompt, abort.signal).finally(() => {
			if (this.hooks.get(sessionId) === hook) this.hooks.delete(sessionId);
		});
	}

	async wait(sessionId: string): Promise<void> {
		const hook = this.hooks.get(sessionId);
		if (!hook) return;
		const failure = await hook.failure;
		if (failure) throw new Error(failure);
	}

	async abort(sessionId: string): Promise<void> {
		const hook = this.hooks.get(sessionId);
		if (!hook) return;
		hook.abort.abort();
		await hook.failure;
	}

	takeTranscript(sessionId: string): SessionMessage[] {
		const transcript = this.transcripts.get(sessionId) ?? [];
		this.transcripts.delete(sessionId);
		return transcript;
	}

	private keepTranscript(sessionId: string, transcript: SessionMessage[]): void {
		this.transcripts.delete(sessionId);
		this.transcripts.set(sessionId, transcript);
		for (const oldest of this.transcripts.keys()) {
			if (this.transcripts.size <= KEPT_TRANSCRIPTS) break;
			this.transcripts.delete(oldest);
		}
	}

	async waitForWorktree(worktreeId: string): Promise<void> {
		const pending = [...this.hooks.values()]
			.filter((hook) => hook.worktreeId === worktreeId)
			.map((hook) => hook.failure);
		await Promise.all(pending);
	}

	decide(args: {
		sessionId: string;
		toolName: string;
		input: Record<string, unknown>;
	}): PermissionResult | null {
		const hook = this.hooks.get(args.sessionId);
		if (!hook) return null;
		const answer = hook.babysit ? decideWithConfig(hook.babysit, args) : null;
		return answer ?? { behavior: "deny", message: HOOK_DENY_MESSAGE };
	}

	private async run(
		sessionId: string,
		prompt: string,
		signal: AbortSignal,
	): Promise<string | null> {
		logActivity("delete-hook", `started for ${sessionId}`);
		let failure: string | null = null;
		try {
			if (this.manager.getSession(sessionId)?.status === "running") {
				await this.manager.interrupt(sessionId);
			}
			if (signal.aborted) {
				logActivity("delete-hook", `aborted for ${sessionId}`);
				return null;
			}
			const idle = this.manager.waitForIdle(sessionId);
			this.manager.pushUserMessage(sessionId, [{ type: "text", text: prompt }]);
			const outcome = await raceOutcome(idle, signal);
			logActivity("delete-hook", `${outcome} for ${sessionId}`);
			if (outcome === "timed-out") failure = "Gave up after 5 minutes";
		} catch (err) {
			failure = describeError(err);
			logActivity("delete-hook", `failed for ${sessionId}: ${failure}`);
		} finally {
			await withTimeout(
				this.manager.cancelAndWait(sessionId),
				TEARDOWN_TIMEOUT_MS,
				"delete hook teardown",
			).catch((err) =>
				console.error("[ccw] delete hook teardown failed:", err),
			);
			this.manager.untapTranscript(sessionId);
		}
		return failure;
	}
}

function raceOutcome(
	idle: Promise<void>,
	signal: AbortSignal,
): Promise<HookOutcome> {
	return new Promise<HookOutcome>((resolve) => {
		const settle = (outcome: HookOutcome) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			resolve(outcome);
		};
		const onAbort = () => settle("aborted");
		const timer = setTimeout(() => settle("timed-out"), DELETE_HOOK_TIMEOUT_MS);
		signal.addEventListener("abort", onAbort, { once: true });
		void idle.then(() => settle("completed"));
	});
}
