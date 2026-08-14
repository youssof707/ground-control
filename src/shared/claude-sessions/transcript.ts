// Message-classification helpers shared by main (ingest-time transcript
// drops in SessionManager.runLoop) and the renderer (message grouping,
// MessageView, sidebar derivations).
//
// Everything here operates on the raw `SessionMessage.content` envelope —
// `{type, parent_tool_use_id, message: {content}}` — which can't be trusted
// (string content on compacted summaries, missing fields on synthesized
// turns), so every accessor runtime-checks.
//
// The provenance discriminator, verified against persisted stores:
//   - Human turns are appended locally (SessionManager.pushUserMessage and
//     the renderer's optimistic echo) WITHOUT a `parent_tool_use_id` key —
//     the SDK never echoes user-pushed turns back through the stream.
//   - Top-level SDK messages carry `parent_tool_use_id: null`.
//   - Subagent traffic carries the spawning tool_use id (a string).
// So: undefined ⇔ human, null ⇔ top-level SDK, string ⇔ subagent.

interface EnvelopeLike {
	parent_tool_use_id?: unknown;
	message?: { content?: unknown };
}

interface BlockLike {
	type?: string;
	text?: string;
}

function envelopeOf(content: unknown): EnvelopeLike | null {
	return typeof content === "object" && content !== null
		? (content as EnvelopeLike)
		: null;
}

// Minimal local copy of the renderer's `blocksOf` (lib/messageContent.ts) —
// that module is renderer-only and main can't import it. Returns [] for
// string/missing content, same as the original.
function blocksOfContent(content: unknown): BlockLike[] {
	const raw = envelopeOf(content)?.message?.content;
	return Array.isArray(raw) ? (raw as BlockLike[]) : [];
}

/** Subagent traffic: the SDK stamps the spawning tool_use id on everything a
 * subagent produces. Human turns omit the key entirely and top-level SDK
 * turns carry null, so string ⇔ subagent. */
export function isSubagentContent(content: unknown): boolean {
	return typeof envelopeOf(content)?.parent_tool_use_id === "string";
}

const TOOL_LIKE_BLOCK_TYPES = new Set([
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
]);

/** Block types that belong in the collapsed tool-run rows regardless of
 * which agent produced them. Suffix-matched rather than enumerated so
 * server-side tool blocks (`server_tool_use`, `mcp_tool_use`) and their
 * result variants (`web_search_tool_result`, `advisor_tool_result`, and
 * whatever the API adds next) fold into runs without a code change. */
export function isToolLikeBlockType(type: string | undefined): boolean {
	if (type === undefined) return false;
	return (
		TOOL_LIKE_BLOCK_TYPES.has(type) ||
		type.endsWith("_tool_use") ||
		type.endsWith("_tool_result")
	);
}

/** Subagent PROSE: a subagent message with no tool-like blocks — the Agent
 * tool's prompt echo (arrives as a `user` message) or the subagent's own
 * narration/report text (`assistant`). Rendered as if the human or top-level
 * Claude said it, so: dropped at ingest going forward, and re-checked in the
 * renderer so pre-existing store rows stay hidden without a migration.
 * Bare-string content counts as prose (no blocks → every() vacuously true). */
export function isSubagentProse(content: unknown): boolean {
	return (
		isSubagentContent(content) &&
		blocksOfContent(content).every((b) => !isToolLikeBlockType(b.type))
	);
}

const INTERRUPT_RE = /^\[(Request interrupted by user[^\]]*)\]$/;

/** Full text of a user turn, tolerating both shapes the SDK emits: a bare
 * string (compaction summaries, <local-command-stdout>) or text blocks. */
function userTextOf(content: unknown): string {
	const raw = envelopeOf(content)?.message?.content;
	if (typeof raw === "string") return raw;
	const blocks = blocksOfContent(content);
	if (blocks.length === 0) return "";
	if (!blocks.every((b) => b.type === "text")) return "";
	return blocks.map((b) => b.text ?? "").join("");
}

/** SDK-synthesized interrupt marker ("[Request interrupted by user]",
 * "[Request interrupted by user for tool use]"). Requires
 * `parent_tool_use_id === null` — the SDK stamps the field on everything it
 * emits, while locally-echoed human turns omit it entirely, so a human
 * literally typing the bracket text still renders as a normal bubble.
 * Returns the label with the square brackets stripped, or null. */
export function interruptMarkerText(content: unknown): string | null {
	if (envelopeOf(content)?.parent_tool_use_id !== null) return null;
	const match = userTextOf(content).trim().match(INTERRUPT_RE);
	return match ? match[1] : null;
}

/** Machine-injected user prose: a `user` message that arrived through the
 * SDK stream (the `parent_tool_use_id` key is present — locally-echoed human
 * turns omit it entirely) carrying no tool-like blocks and no interrupt
 * marker. The SDK never echoes the human's typed turns back through the
 * stream, so ANY such message is content the CLI injected on its own —
 * Skill instruction expansions ("Base directory for this skill: …"),
 * slash-command expansions, compaction summaries, <local-command-stdout>,
 * and whatever gets added next. Catch-all by design: hiding keys off
 * provenance, not on recognizing each injection shape. Subagent prompt
 * echoes (ptid = string) match too — same verdict either way. */
export function isInjectedUserProse(content: unknown): boolean {
	const env = envelopeOf(content);
	if (!env || !("parent_tool_use_id" in env)) return false; // human local echo
	if (blocksOfContent(content).some((b) => isToolLikeBlockType(b.type))) {
		return false; // tool results — belongs to the tool-run rows
	}
	return interruptMarkerText(content) === null;
}

/** Mirrors UserMessage's hasVisibleContent guard (MessageView.tsx): a user
 * turn with no renderable blocks — bare-string content like
 * <local-command-stdout>, or whitespace-only text — renders nothing in the
 * transcript. */
export function hasVisibleUserContent(content: unknown): boolean {
	return blocksOfContent(content).some((b) =>
		b.type === "text" ? (b.text ?? "").trim().length > 0 : true,
	);
}

/** Messages the sidebar's conversation-derived UI (summary text, "last
 * incoming" timestamps, unread badges) must skip: ALL subagent traffic
 * (prose is hidden; tool traffic lives in collapsed tool-run rows, not the
 * conversation) plus user turns that render nothing. `system`/`result` roles
 * are already excluded by the role checks at every call site. */
export function isConversationSkipped(role: string, content: unknown): boolean {
	if (isSubagentContent(content)) return true;
	if (role !== "user") return false;
	return isInjectedUserProse(content) || !hasVisibleUserContent(content);
}
