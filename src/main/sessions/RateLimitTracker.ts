import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import { broadcast } from "../windows";

/**
 * Tracks the latest claude.ai subscription rate-limit info surfaced by the
 * Agent SDK as `rate_limit_event` messages. Lives in-process — these events
 * are transient state, not conversation history, so we don't persist to disk.
 *
 * Keyed by `rateLimitType` ('five_hour' | 'seven_day' | …) so independent
 * windows can each track their own roll-up. Empty-string key buckets events
 * that arrive without a type (defensive — the SDK marks the field optional).
 *
 * Each `update` broadcasts the full snapshot to every renderer window. The
 * renderer also calls `snapshot()` once on mount to rehydrate.
 *
 * Note: only fires for OAuth (claude.ai) callers. With ANTHROPIC_API_KEY set
 * the SDK never emits `rate_limit_event` and the meter stays hidden.
 */

export type RateLimitType = NonNullable<SDKRateLimitInfo["rateLimitType"]>;
export type RateLimitSnapshot = Partial<Record<RateLimitType, SDKRateLimitInfo>>;

const state: { byType: RateLimitSnapshot } = { byType: {} };

export function update(info: SDKRateLimitInfo): void {
	// Diagnostic — dump the full event so we can see exactly what fields the
	// SDK is populating. Some fields (utilization in particular) are typed
	// optional and we want visibility into when they're present vs absent.
	console.log("[ccw][rate-limit] event:", JSON.stringify(info));
	// `rateLimitType` is optional in the SDK type but in practice every event
	// we've observed carries one. Bucket untyped events under "_unknown" so
	// they're still visible in the snapshot for diagnosis rather than silently
	// dropped.
	const key = info.rateLimitType ?? ("_unknown" as RateLimitType);
	state.byType[key] = info;
	broadcast("rateLimit:update", snapshot());
}

export function snapshot(): RateLimitSnapshot {
	return { ...state.byType };
}
