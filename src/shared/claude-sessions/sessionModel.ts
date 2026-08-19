import type { ClaudeSessionFull } from "../schemas/claude_session";

/**
 * Model display + derivation helpers for the session footer's model label
 * and the model picker modal.
 *
 * Lives in `shared/` because both sides need it: the renderer derives the
 * displayed label and the picker highlight from it, and the main process
 * reuses the same stream predicates to sync `session.model` back to whatever
 * the CLI is actually running.
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
export function isSentinelModel(id: string): boolean {
	return id.startsWith("<") && id.endsWith(">");
}

/**
 * The model a single SDK stream message reports, or null if this message
 * carries no usable model evidence.
 *
 * Shared by the renderer's `latestStreamModel` scan and the main process's
 * per-message sync so the two can never drift on *which* messages count:
 *   - only top-level `assistant` messages (subagent traffic —
 *     `parent_tool_use_id` set — routinely runs a different model)
 *   - never sentinel ids (`<synthetic>` and friends)
 */
export function assistantStreamModel(content: unknown): string | null {
	if (!isRecord(content)) return null;
	// Strict `=== null`: the SDK stamps exactly `null` on top-level turns.
	// Anything else (a tool-use id, or the field missing entirely) is not
	// something we can attribute to the main conversation.
	if (content.parent_tool_use_id !== null) return null;
	const msg = content.message;
	if (!isRecord(msg) || typeof msg.model !== "string") return null;
	if (isSentinelModel(msg.model)) return null;
	return msg.model;
}

/** Latest model reported by the stream itself, with the message timestamp.
 * Top-level assistant messages win; the system init message is the
 * pre-first-response fallback. */
function latestStreamModel(
	session: ClaudeSessionFull,
): { model: string; ts: number } | null {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role !== "assistant") continue;
		const model = assistantStreamModel(m.content);
		if (model !== null) return { model, ts: m.ts };
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

// ─── Identity matching ───────────────────────────────────────────────────────

/**
 * Why this exists: the stream stamps *concrete* model ids
 * ("claude-sonnet-4-5-20250929", sometimes with a "[1m]" suffix), while the
 * picker's rows carry the CLI's *aliases* ("sonnet", "opus", "sonnet[1m]").
 * `ModelInfo` has no field linking the two, so the only way to ask "is this
 * row the model that's running?" is to reduce both sides to a structural
 * identity and compare that.
 */
export interface ModelIdentity {
	/** Lowercased family: "opus", "sonnet", "haiku", … */
	family: string;
	major?: number;
	minor?: number;
	/** The CLI's 1M-context variant. Distinguishes the "Sonnet 4.6" row from
	 * the "Sonnet 4.6 with 1M context" row, which are otherwise identical. */
	oneM: boolean;
}

/** True for the CLI's "[1m]" decoration. Must be read *before*
 * `normalizeModelId`, which strips exactly this suffix. */
function hasOneMSuffix(raw: string): boolean {
	return /\[\s*1m\s*\]\s*$/i.test(raw.trim());
}

/**
 * Identity of a raw model id — either a concrete stream id
 * ("claude-opus-4-7-20250101", "claude-3-5-haiku-20241022") or a bare CLI
 * alias ("opus", "sonnet[1m]"). Returns null for sentinels and anything
 * unparseable, which `identityMatches` treats as "matches nothing".
 */
export function parseModelIdentity(
	raw: string | undefined,
): ModelIdentity | null {
	if (!raw) return null;
	const oneM = hasOneMSuffix(raw);
	const bare = normalizeModelId(raw);
	if (!bare || isSentinelModel(bare)) return null;

	let m = bare.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d+))?/);
	if (m) {
		return {
			family: m[1].toLowerCase(),
			major: Number(m[2]),
			minor: m[3] ? Number(m[3]) : undefined,
			oneM,
		};
	}
	m = bare.match(/^claude-(\d+)(?:[-.](\d+))?-([a-z]+)/);
	if (m) {
		return {
			family: m[3].toLowerCase(),
			major: Number(m[1]),
			minor: m[2] ? Number(m[2]) : undefined,
			oneM,
		};
	}
	// Bare alias with no version information: "opus", "sonnet", "opusplan".
	if (/^[a-z]+$/i.test(bare)) return { family: bare.toLowerCase(), oneM };
	return null;
}

/**
 * Identity of a human-facing display string — the CLI's description head,
 * e.g. "Sonnet 4.6" or "Opus 4.7 with 1M context". This is where a
 * versionless alias row ("sonnet") picks up its version.
 */
export function parseDisplayIdentity(
	text: string | undefined,
): ModelIdentity | null {
	if (!text) return null;
	const m = text.match(/^\s*([A-Za-z]+)\s+(\d+)(?:\.(\d+))?/);
	if (!m) return null;
	return {
		family: m[1].toLowerCase(),
		major: Number(m[2]),
		minor: m[3] ? Number(m[3]) : undefined,
		oneM: /\b1m\b/i.test(text),
	};
}

/**
 * Identity of a picker row, combining its `value` (authoritative for family
 * and the "[1m]" flag) with its description (the only place the version
 * appears when `value` is a bare alias).
 */
export function parseOptionIdentity(
	value: string | undefined,
	description?: string,
): ModelIdentity | null {
	const fromValue = parseModelIdentity(value);
	// A concrete id already carries everything; don't let prose override it.
	if (fromValue?.major !== undefined) return fromValue;

	const fromText = parseDisplayIdentity(description);
	if (fromValue && fromText && fromValue.family === fromText.family) {
		return { ...fromText, oneM: fromValue.oneM || fromText.oneM };
	}
	return fromValue ?? fromText;
}

/**
 * Do two identities refer to the same model? Family and the 1M flag must
 * agree exactly; versions are compared only when *both* sides carry them, so
 * a versionless alias ("opus") matches whichever Opus the stream reports.
 */
export function identityMatches(
	a: ModelIdentity | null,
	b: ModelIdentity | null,
): boolean {
	if (!a || !b) return false;
	if (a.family !== b.family) return false;
	if (a.oneM !== b.oneM) return false;
	if (a.major !== undefined && b.major !== undefined) {
		if (a.major !== b.major) return false;
		if (a.minor !== undefined && b.minor !== undefined && a.minor !== b.minor) {
			return false;
		}
	}
	return true;
}
