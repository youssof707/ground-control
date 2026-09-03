import type { DictationHandle } from "../components/DictationButton";

/**
 * Live dictation handles, keyed by the id their composer uses in
 * `useDraftStore` (a session/draft id for the main composer, a sidequest id
 * for the panel's). Lets the global ⌘D handler in `useDictationHotkey` reach
 * the right `DictationButton` instance from a window keydown listener, the
 * same way `data-composer-session-id` lets ⌘K/⌘P find the focused composer.
 *
 * Deliberately store-only (no hooks), same rationale as `lib/composerActions.ts`
 * / `lib/sidequestActions.ts`: this must be callable from a window keydown
 * listener outside React's render cycle.
 *
 * Stores a REF BOX per scope, not the handle object itself:
 * `DictationButton`'s `useImperativeHandle` has no dep array on purpose — its
 * `stopAndTranscribe` closes over `onInsert`, which closes over the owning
 * composer's current draft text. Caching the handle object here would insert
 * a transcript against a stale draft after the owner re-renders.
 */
const registry = new Map<string, { current: DictationHandle }>();

/**
 * Registers `box` under `scope`. Returns a disposer that removes it —
 * identity-guarded so a stale cleanup (StrictMode's setup→cleanup→setup, or a
 * composer re-keying mid-navigation) can't evict a newer registration for the
 * same scope.
 */
export function registerDictationHandle(
	scope: string,
	box: { current: DictationHandle },
): () => void {
	registry.set(scope, box);
	return () => {
		if (registry.get(scope) === box) registry.delete(scope);
	};
}

export function getDictationHandle(scope: string): DictationHandle | null {
	return registry.get(scope)?.current ?? null;
}
