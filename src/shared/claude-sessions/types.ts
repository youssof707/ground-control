// Re-export shim. The canonical source is the Zod schemas in
// `src/shared/schemas/claude_session.ts` (per arch.md). All consumers should
// be migrated to import from there directly; this file is kept stable so we
// don't mass-rewrite imports today.

/**
 * A live background task inside the CLI (dev server, background bash,
 * subagent, workflow). Transient by nature — streamed from the SDK, never
 * persisted — which is why it's a plain interface here and not a Zod schema
 * in `claude_session.ts`. Produced by `SessionActivity.liveTasks` (main),
 * consumed by `useLiveTasksStore` (renderer) via the `session:tasks` /
 * `sidequest:tasks` broadcasts.
 */
export interface LiveBackgroundTask {
	id: string;
	/** CLI `task_type` (`local_bash`, `local_agent`, `local_workflow`, …). */
	type: string | undefined;
	/** Human-readable label from the CLI, e.g. "Start API server on 3011". */
	description: string;
	/** When main first learned of the task (epoch ms) — drives elapsed time. */
	startedAt: number;
}

export type {
	ClaudeSession,
	ClaudeSessionFull,
	SessionStatus,
	SessionMode,
	SessionMessage,
	SessionMessageRole,
	StartSessionInput,
	PermissionRequest,
	PermissionDecision,
	UserContentBlock,
	UserTextBlock,
	UserImageBlock,
	UserImageMediaType,
	UserTurn,
} from "../schemas/claude_session";
