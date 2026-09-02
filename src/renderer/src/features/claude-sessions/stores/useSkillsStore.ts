import { create } from "zustand";
import type { Skill } from "@shared/schemas/skills";

/**
 * Pure cache of the user's personal global Claude skills
 * (`~/.claude/skills/`), mirroring useShortcutsStore but read-only: no
 * upsert/remove because skills are authored on disk, never mutated from
 * the app. Hydrated by useSessionsBootstrap at launch and re-hydrated by
 * the shortcuts modal's open-triggered refresh — both render this
 * in-memory copy immediately and swap in the fresh list when it lands.
 */
interface State {
	skills: Skill[];
	hydrate: (list: Skill[]) => void;
}

export const useSkillsStore = create<State>((set) => ({
	skills: [],
	hydrate: (list) => set({ skills: list }),
}));
