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
	/** True when the user explicitly named this session — either by typing
	 * a name in the draft header's name box before the first send, or via
	 * `session:rename` at any point. Suppresses the derive-title-from-the-
	 * first-user-message behaviour in `SessionManager.pushUserMessage`,
	 * which would otherwise clobber a deliberately-chosen name on a session
	 * that hadn't spoken yet. The Zod default backfills rows on disk that
	 * predate this field. */
	titleLocked: z.boolean().default(false),
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
	/** App-owned git worktree the session's SDK query runs inside. Set
	 * once at session creation (from the draft's `worktreeId`) and never
	 * changed after — sessions are permanently bound to their worktree.
	 * When unset, the SDK runs directly in `cwd`. See `SessionManager.
	 * resolveEffectiveCwd`. In the sidebar, worktree sessions bucket into
	 * their own section (labeled "folder: displayName"); the chat header
	 * still shows the worktree as a chip. */
	worktreeId: z.string().optional(),
	/** Requested model override for the session's SDK query (e.g.
	 * "claude-opus-4-6"). Passed to the SDK at query start and switchable
	 * live via `SessionManager.setModel`. Unset = the CLI default model
	 * (~/.claude settings). Note this is the *requested* model — the model
	 * actually in use is derived in the renderer from the SDK message
	 * stream, which self-corrects on fallback flips. */
	model: z.string().optional(),
	/** When the model override last changed (Date.now()). Lets the renderer
	 * distinguish "switch requested, no response yet" (label shows the new
	 * model as pending) from "SDK answered with a different model after the
	 * switch" (label trusts the stream — e.g. a fallback flip). */
	modelChangedAt: z.number().optional(),
	/** Sidebar session group the row is filed under. Mutable (unlike
	 * `worktreeId`): set/cleared via `groups:setSessionGroup`. Membership
	 * survives archiving — an archived member is merely hidden with the
	 * rest of the group and returns to it on unarchive. When the last
	 * member leaves a group (removed or deleted, not archived), main
	 * auto-deletes the group record. A dangling id (group missing)
	 * renders as "ungrouped" in the sidebar. */
	groupId: z.string().optional(),
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

export const StartSessionInputSchema = z.object({
	title: z.string(),
	/** Set when `title` is a name the user typed themselves (draft header
	 * name box), so the created session is born with its title locked and
	 * the first message never re-derives it. Omitted/false means `title` is
	 * just the provisional `Session N` placeholder. */
	titleLocked: z.boolean().optional(),
	prompt: z.string().optional(),
	cwd: z.string(),
	mode: SessionModeSchema.optional(),
	worktreeId: z.string().optional(),
	model: z.string().optional(),
});
export type StartSessionInput = z.infer<typeof StartSessionInputSchema>;
