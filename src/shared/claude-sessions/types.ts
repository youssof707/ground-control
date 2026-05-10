// Re-export shim. The canonical source is the Zod schemas in
// `src/shared/schemas/claude_session.ts` (per arch.md). All consumers should
// be migrated to import from there directly; this file is kept stable so we
// don't mass-rewrite imports today.

export type {
	ClaudeSession,
	ClaudeSessionFull,
	SessionStatus,
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
