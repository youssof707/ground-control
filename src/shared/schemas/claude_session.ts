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
	startCommit: z.string().optional(),
	diff: z.string().optional(),
	/** Underlying Claude Agent SDK session id, captured from the SDK's
	 * first message that carries one. Required to resume after a restart. */
	sdkSessionId: z.string().optional(),
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
	prompt: z.string().optional(),
	cwd: z.string(),
});
export type StartSessionInput = z.infer<typeof StartSessionInputSchema>;
