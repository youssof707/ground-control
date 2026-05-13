import { create } from "zustand";
import type { Worktree } from "@shared/schemas/worktree";

/**
 * Cache of every worktree the app knows about, indexed by id. Hydrated on
 * boot via `window.claude.listWorktrees()` and re-hydrated on every
 * `state:changed` ping from main (same pattern as `useReadStore`).
 *
 * Read by the WorktreeChip in SessionChat to render the linked worktree's
 * branch name without an extra per-session IPC call.
 *
 * No optimistic update path here today: linking a worktree is the only
 * mutation, and after the IPC succeeds the main process broadcasts
 * `state:changed`, which triggers a full re-hydration. If the link modal
 * ever needs an instant local "I just created this" update, add an
 * `upsert(worktree)` setter and call it on the IPC's resolved value.
 */
interface State {
	worktrees: Record<string, Worktree>;
	hydrate: (list: Worktree[]) => void;
	upsert: (wt: Worktree) => void;
}

export const useWorktreesStore = create<State>((set) => ({
	worktrees: {},
	hydrate: (list) =>
		set(() => {
			const map: Record<string, Worktree> = {};
			for (const w of list) map[w.id] = w;
			return { worktrees: map };
		}),
	upsert: (wt) =>
		set((s) => ({ worktrees: { ...s.worktrees, [wt.id]: wt } })),
}));
