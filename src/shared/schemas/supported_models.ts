import { z } from "zod";

/**
 * Persisted cache of the SDK's `supportedModels()` result. Written every time
 * any session successfully fetches the list, read on app boot before any
 * session has a live query. Frees the model picker from the hardcoded
 * `FALLBACK_MODELS` stub on every launch after the first successful fetch —
 * the stub is only shown on truly-fresh installs.
 *
 * `.passthrough()` on entries keeps forward-compatible fields (new SDK flags
 * like `supportsFastMode`) intact through the round-trip, so we don't have
 * to bump the schema every time the SDK adds a capability bit.
 */
export const SupportedModelEntrySchema = z
	.object({
		value: z.string(),
		displayName: z.string(),
		description: z.string(),
	})
	.passthrough();

export const SupportedModelsFileSchema = z.object({
	models: z.array(SupportedModelEntrySchema),
	/** ms epoch of the last successful fetch — for debugging / future TTL. */
	fetchedAt: z.number().int().nonnegative(),
});

export type SupportedModelEntry = z.infer<typeof SupportedModelEntrySchema>;
export type SupportedModelsFile = z.infer<typeof SupportedModelsFileSchema>;
