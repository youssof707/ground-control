import { create } from "zustand";
import type { SessionGroup } from "@shared/schemas/session_groups";

/**
 * Renderer-side cache of the sidebar session-group registry. Source of
 * truth lives in the main process (`session_groups.json`); this store
 * hydrates on boot via `useSessionsBootstrap` and re-hydrates on every
 * `state:changed` ping from main.
 *
 * Membership is NOT stored here — it lives on `session.groupId` in
 * `useSessionsStore` and arrives via `session:patch` broadcasts. This
 * store only carries the group records (name, color, createdAt,
 * collapsed).
 */
interface State {
	groups: Record<string, SessionGroup>;
	hydrate: (list: SessionGroup[]) => void;
	/**
	 * Insert-or-replace a single group without waiting for a refetch.
	 * Two callers:
	 *   - AddToGroupModal after a create round-trip (main's
	 *     `state:changed` is skip-self, so the originating window would
	 *     otherwise render the member row before its group header exists).
	 *   - The sidebar's collapse toggle, optimistically, so the section
	 *     folds on the same tick as the click.
	 */
	upsert: (g: SessionGroup) => void;
	/** Drop a group from the local cache. Mirrors useWorktreesStore. */
	remove: (id: string) => void;
}

export const useSessionGroupsStore = create<State>((set) => ({
	groups: {},
	hydrate: (list) => {
		const map: Record<string, SessionGroup> = {};
		for (const g of list) {
			map[g.id] = g;
		}
		set({ groups: map });
	},
	upsert: (g) => set((s) => ({ groups: { ...s.groups, [g.id]: g } })),
	remove: (id) =>
		set((s) => {
			if (!(id in s.groups)) return s;
			const next = { ...s.groups };
			delete next[id];
			return { groups: next };
		}),
}));
