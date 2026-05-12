import { create } from "zustand";
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

// Mirrors the snapshot shape from `src/main/sessions/RateLimitTracker.ts`.
// Defined here (rather than imported from preload) so the renderer doesn't
// reach across tiers — the SDK type import is type-only, so no runtime
// coupling to a Node-only package.
export type RateLimitType = NonNullable<SDKRateLimitInfo["rateLimitType"]>;
export type RateLimitSnapshot = Partial<Record<RateLimitType, SDKRateLimitInfo>>;

/**
 * Latest claude.ai subscription rate-limit snapshot, keyed by `rateLimitType`
 * (e.g. 'five_hour'). Source of truth lives in the main process
 * (`RateLimitTracker`); this store mirrors it for the renderer.
 *
 * Hydration: `useSessionsBootstrap` calls `window.claude.getRateLimit()` once
 * on mount, then subscribes to `"rateLimit:update"` broadcasts.
 *
 * Stays empty for ANTHROPIC_API_KEY users — the SDK only emits these events
 * for OAuth (claude.ai) sessions. Components must handle the empty case.
 */
interface State {
	byType: RateLimitSnapshot;
	hydrated: boolean;
	hydrate: (snapshot: RateLimitSnapshot) => void;
}

export const useRateLimitStore = create<State>((set) => ({
	byType: {},
	hydrated: false,
	hydrate: (snapshot) => set({ byType: { ...snapshot }, hydrated: true }),
}));
