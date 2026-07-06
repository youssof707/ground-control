import { create } from "zustand";
import type { Worktree } from "@shared/schemas/worktrees";

/**
 * Renderer-side cache of the app-owned worktree registry. Source of truth
 * lives in the main process (`worktrees.json`); this store hydrates on
 * boot via `useSessionsBootstrap` and re-hydrates on every `state:changed`
 * ping from main.
 *
 * Consumers read entries by id (session-header badge, sidebar chip) and by
 * baseDir (draft-time "existing worktrees" list, resolved inline in the
 * modal via `window.claude.listWorktreesForBaseDir` for freshness). This
 * store is the fast local lookup for the by-id case.
 */
interface State {
	worktrees: Record<string, Worktree>;
	hydrate: (list: Worktree[]) => void;
	/**
	 * Insert-or-replace a single worktree without waiting for a full
	 * refetch. Called after a local create/attach round-trip so the chip
	 * flips over from "Add worktree" → `<WorktreeChip>` on the same tick
	 * as `draft.worktreeId` is set — otherwise there's a race where the
	 * draft carries an id the store can't resolve, and the button stays
	 * visible until the `state:changed` broadcast (which the originating
	 * window is skipped from).
	 */
	upsert: (wt: Worktree) => void;
	/**
	 * Drop a worktree from the local cache after a successful in-window
	 * delete. Mirrors `upsert`: `state:changed` is skip-self on main, so
	 * without this the originating window would keep rendering stale
	 * chips/rows until the next hydrate.
	 */
	remove: (id: string) => void;
}

export const useWorktreesStore = create<State>((set) => ({
	worktrees: {},
	hydrate: (list) => {
		const map: Record<string, Worktree> = {};
		for (const wt of list) {
			map[wt.id] = wt;
		}
		set({ worktrees: map });
	},
	upsert: (wt) =>
		set((s) => ({ worktrees: { ...s.worktrees, [wt.id]: wt } })),
	remove: (id) =>
		set((s) => {
			if (!(id in s.worktrees)) return s;
			const next = { ...s.worktrees };
			delete next[id];
			return { worktrees: next };
		}),
}));
