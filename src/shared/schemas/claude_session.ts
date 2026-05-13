import { z } from "zod";

// ─── Status & roles ──────────────────────────────────────────────────────────

export const SessionStatusSchema = z.enum([
	"idle",
	"running",
	"awaiting_permission",
	"done",
	"errored",
	"cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// Two app-level modes a session can be in. Maps to Claude Agent SDK
// permission modes at the boundary:
//   "plan"        → SDK "plan"        (read-only research / planning)
//   "acceptEdits" → SDK "acceptEdits" (file edits auto-approved; other
//                                      tools still route through the broker)
export const SessionModeSchema = z.enum(["plan", "acceptEdits"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionMessageRoleSchema = z.enum([
	"user",
	"assistant",
	"tool_use",
	"tool_result",
	"system",
	"result",
]);
export type SessionMessageRole = z.infer<typeof SessionMessageRoleSchema>;

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

export const SessionMessageSchema = z.object({
	id: z.string(),
	role: SessionMessageRoleSchema,
	content: z.unknown(),
	ts: z.number(),
});
export type SessionMessage = z.infer<typeof SessionMessageSchema>;

// ─── User input content blocks ───────────────────────────────────────────────

export const UserImageMediaTypeSchema = z.enum([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);
export type UserImageMediaType = z.infer<typeof UserImageMediaTypeSchema>;

export const UserTextBlockSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});
export type UserTextBlock = z.infer<typeof UserTextBlockSchema>;

export const UserImageBlockSchema = z.object({
	type: z.literal("image"),
	source: z.object({
		type: z.literal("base64"),
		media_type: UserImageMediaTypeSchema,
		data: z.string(),
	}),
});
export type UserImageBlock = z.infer<typeof UserImageBlockSchema>;

export const UserContentBlockSchema = z.discriminatedUnion("type", [
	UserTextBlockSchema,
	UserImageBlockSchema,
]);
export type UserContentBlock = z.infer<typeof UserContentBlockSchema>;

export const UserTurnSchema = z.object({
	sessionId: z.string(),
	blocks: z.array(UserContentBlockSchema),
});
export type UserTurn = z.infer<typeof UserTurnSchema>;

// ─── Permission ──────────────────────────────────────────────────────────────

export const PermissionRequestSchema = z.object({
	requestId: z.string(),
	sessionId: z.string(),
	toolName: z.string(),
	input: z.record(z.string(), z.unknown()),
	createdAt: z.number(),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const PermissionDecisionSchema = z.discriminatedUnion("behavior", [
	z.object({
		requestId: z.string(),
		behavior: z.literal("allow"),
		updatedInput: z.record(z.string(), z.unknown()).optional(),
		// When true, auto-allow future requests for the same tool name for the
		// remainder of this app session (no persistence across restarts).
		remember: z.boolean().optional(),
	}),
	z.object({
		requestId: z.string(),
		behavior: z.literal("deny"),
		message: z.string(),
	}),
]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

// ─── Top-level model ─────────────────────────────────────────────────────────

export const ClaudeSessionSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	cwd: z.string(),
	status: SessionStatusSchema,
	createdAt: z.number(),
	finishedAt: z.number().optional(),
	error: z.string().optional(),
	branch: z.string().optional(),
	/** Branch tracked by the staleness chip. Compared with `branch` (the
	 * live value) to decide whether the chip should render in a "stale" /
	 * red state. Set in two places:
	 *   - SessionManager.run seeds it with the project's detected default
	 *     base branch (origin/HEAD, else local main, else master, else
	 *     unset) so the chip flags drift the moment a session is created
	 *     on a feature branch — no first message required.
	 *   - SessionManager.snapshotBranchCheckpoint overwrites it with the
	 *     live branch on every user-driven checkpoint (message sent,
	 *     permission/plan/ask-user prompt answered), so it converges on
	 *     "branch in effect the last time the user acted". */
	lastUserMessageBranch: z.string().optional(),
	startCommit: z.string().optional(),
	diff: z.string().optional(),
	/** Underlying Claude Agent SDK session id, captured from the SDK's
	 * first message that carries one. Required to resume after a restart. */
	sdkSessionId: z.string().optional(),
	/** App-level permission mode for the session. Every session is always
	 * in exactly one of these states; new sessions default to "plan". The
	 * Zod default also backfills pre-existing rows on disk that predate
	 * this field. */
	mode: SessionModeSchema.default("plan"),
	/** When set, the session is hidden from the sidebar list. Reversible
	 * (no destruction of data) — sessions remain reachable by URL and
	 * every other system path treats them normally. There is no UI today
	 * to list / restore archived sessions; that comes later. */
	archivedAt: z.number().optional(),
	/** Optional link to a Worktree record (see schemas/worktree.ts).
	 *
	 * Once set, the link is immutable for the life of the session — every
	 * subsequent SDK invocation, git op, and file write happens inside the
	 * worktree (because `session.cwd` is rewritten to the worktree's path
	 * at link time). Forks inherit the link from their parent. Deleting
	 * the session does NOT delete the worktree: worktrees are persistent,
	 * app-owned entities (the user can spin up a new session against the
	 * same worktree later). */
	worktreeId: z.string().optional(),
});
export type ClaudeSession = z.infer<typeof ClaudeSessionSchema>;

export const ClaudeSessionFullSchema = ClaudeSessionSchema.extend({
	messages: z.array(SessionMessageSchema),
});
export type ClaudeSessionFull = z.infer<typeof ClaudeSessionFullSchema>;

// ─── File schema ─────────────────────────────────────────────────────────────

export const ClaudeSessionsFileSchema = z.object({
	items: z.record(z.string(), ClaudeSessionFullSchema),
});
export type ClaudeSessionsFile = z.infer<typeof ClaudeSessionsFileSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Optional worktree directive on session start. The "ephemeral draft"
 * UX in the renderer holds a session in memory until either:
 *   - the user sends a first message (no worktree → plain start), or
 *   - the user picks a worktree in the link modal (this field set).
 *
 * Two variants:
 *   - `kind: "new"`     — create a fresh worktree off origin's default
 *                         branch at the source `cwd`, name the new branch
 *                         `branch`.
 *   - `kind: "existing"` — use an already-known worktree by id (must
 *                         belong to the same repo as `cwd`).
 *
 * Always resolved server-side in `SessionManager.run` before persisting
 * the session, so a failed worktree op leaves zero state on disk.
 */
export const StartSessionWorktreeOptionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("new"), branch: z.string() }),
	z.object({ kind: z.literal("existing"), worktreeId: z.string() }),
]);
export type StartSessionWorktreeOption = z.infer<
	typeof StartSessionWorktreeOptionSchema
>;

export const StartSessionInputSchema = z.object({
	title: z.string(),
	prompt: z.string().optional(),
	cwd: z.string(),
	mode: SessionModeSchema.optional(),
	worktree: StartSessionWorktreeOptionSchema.optional(),
});
export type StartSessionInput = z.infer<typeof StartSessionInputSchema>;
