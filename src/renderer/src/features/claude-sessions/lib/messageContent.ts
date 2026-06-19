import type { SessionMessage } from "@shared/claude-sessions/types";

// Shape of a SessionMessage's `content` field as it comes out of the Claude
// Agent SDK. We can't trust it: the SDK emits messages with various shapes
// (string content on compacted summaries, missing `message` on system/result
// turns, etc.), so anything that pulls `message.content` MUST runtime-check
// for an array before iterating.
export interface SdkLike {
	type?: string;
	subtype?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
	[k: string]: unknown;
}

export interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	input?: unknown;
	id?: string;
	tool_use_id?: string;
	is_error?: boolean;
	content?: unknown;
	source?: { media_type?: string; data?: string; type?: string };
	[k: string]: unknown;
}

// Safely extract the content blocks of a SessionMessage. Returns [] if the
// underlying `message.content` is missing, not an array, or any other
// unexpected shape. This is the single source of truth — every callsite that
// needs to iterate message blocks should go through here so we never crash
// the renderer on a malformed SDK message (e.g., the post-/compact summary,
// which can arrive with `content` as a plain string).
export function blocksOf(m: SessionMessage): ContentBlock[] {
	return blocksOfSdk(m.content as SdkLike | undefined);
}

// Variant for callers that already hold the SdkLike — saves them from
// reconstructing a SessionMessage just to call `blocksOf`.
export function blocksOfSdk(sdk: SdkLike | undefined): ContentBlock[] {
	const raw = sdk?.message?.content;
	return Array.isArray(raw) ? (raw as ContentBlock[]) : [];
}
