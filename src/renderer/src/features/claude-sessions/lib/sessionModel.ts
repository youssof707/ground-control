import type { ClaudeSessionFull } from "@shared/schemas/claude_session";

/**
 * Model display + derivation helpers for the session footer's model label
 * and the model picker modal.
 *
 * Accuracy contract: the label must reflect the model *actually* producing
 * responses — not just the requested override — so fallback flips, `/model`
 * inside the SDK, or CLI-default changes are always visible. We therefore
 * derive the display from the SDK message stream and only trust
 * `session.model` (the requested override) while a switch is still awaiting
 * its first response.
 */

// ─── Stream derivation ───────────────────────────────────────────────────────

/** Result of deriving the label. `pending` = a model switch was requested but
 * no assistant response has confirmed it yet (render dimmed/italic). */
export interface DisplayedModel {
	/** Model id to show, or undefined = "default" (no override, no stream
	 * evidence yet). */
	model: string | undefined;
	pending: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

/** Sentinel model ids the CLI stamps on messages it injects itself
 * (compaction summaries, system-generated turns, heartbeat no-ops). Not a
 * real model — must not become the displayed label. */
function isSentinelModel(id: string): boolean {
	return id.startsWith("<") && id.endsWith(">");
}

/** Latest model reported by the stream itself, with the message timestamp.
 * Top-level assistant messages win (subagent traffic — parent_tool_use_id
 * set — often runs a different model and is skipped); sentinel-model
 * messages (e.g. `<synthetic>`) are skipped too; the system init message
 * is the pre-first-response fallback. */
function latestStreamModel(
	session: ClaudeSessionFull,
): { model: string; ts: number } | null {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant" || !isRecord(m.content)) continue;
		if (m.content.parent_tool_use_id !== null) continue;
		const msg = m.content.message;
		if (isRecord(msg) && typeof msg.model === "string") {
			if (isSentinelModel(msg.model)) continue;
			return { model: msg.model, ts: m.ts };
		}
	}
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "system" || !isRecord(m.content)) continue;
		if (m.content.subtype !== "init") continue;
		if (typeof m.content.model === "string" && !isSentinelModel(m.content.model)) {
			return { model: m.content.model, ts: m.ts };
		}
	}
	return null;
}

export function deriveDisplayedModel(session: ClaudeSessionFull): DisplayedModel {
	const stream = latestStreamModel(session);

	// Optimistic window: an override was set and nothing in the stream
	// postdates it → show the requested model as pending. The moment an
	// assistant message lands after the switch, the stream wins again — so
	// a fallback flip can never leave the label stuck on the request.
	if (
		session.model &&
		session.modelChangedAt !== undefined &&
		(!stream || stream.ts < session.modelChangedAt) &&
		normalizeModelId(session.model) !==
			(stream ? normalizeModelId(stream.model) : undefined)
	) {
		return { model: session.model, pending: true };
	}

	if (stream) return { model: stream.model, pending: false };
	return { model: session.model, pending: false };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Strip SDK decorations like a trailing "[1m]" (seen on system-init model
 * ids) so comparisons and display work on the bare id. */
export function normalizeModelId(id: string): string {
	return id.replace(/\[[^\]]*\]\s*$/, "").trim();
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "claude-opus-4-7" / "claude-sonnet-4-5-20250929" → "Opus 4.7" / "Sonnet 4.5";
 * "claude-3-5-haiku-…" → "Haiku 3.5"; bare aliases ("opus") → "Opus";
 * anything unrecognized → the raw id. */
export function formatModelName(id: string): string {
	const bare = normalizeModelId(id);
	let m = bare.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d+))?/);
	if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
	m = bare.match(/^claude-(\d+)(?:[-.](\d+))?-([a-z]+)/);
	if (m) return `${cap(m[3])} ${m[1]}${m[2] ? `.${m[2]}` : ""}`;
	if (/^[a-z]+$/.test(bare)) return cap(bare);
	return bare;
}

