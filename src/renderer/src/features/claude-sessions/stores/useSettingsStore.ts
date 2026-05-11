import { create } from "zustand";
import type { AppSettingsFile } from "@shared/schemas/app_settings";

/**
 * App-wide user preferences. Source of truth lives in the main process
 * (`app_settings.json`); this store is a thin in-memory cache that:
 *   - hydrates on app boot (via `useSessionsBootstrap`),
 *   - re-hydrates on every `state:changed` ping from main,
 *   - applies optimistic local updates in `setLastUsedWorkspace` so the
 *     originating window's UI doesn't wait for a round-trip.
 *
 * No localStorage — every window reads from the same JSON file via IPC, so
 * there's no risk of windows drifting out of sync.
 */
interface State {
	lastUsedWorkspace?: string;
	sessionsSidebarWidth?: number;
	hydrate: (settings: AppSettingsFile) => void;
	setLastUsedWorkspace: (cwd: string) => void;
	setSessionsSidebarWidth: (width: number) => void;
}

export const useSettingsStore = create<State>((set, get) => ({
	lastUsedWorkspace: undefined,
	sessionsSidebarWidth: undefined,
	hydrate: (settings) =>
		set({
			lastUsedWorkspace: settings.lastUsedWorkspace,
			sessionsSidebarWidth: settings.sessionsSidebarWidth,
		}),
	setLastUsedWorkspace: (cwd) => {
		// No-op if unchanged — avoids unnecessary IPC churn when starting
		// repeated sessions in the same workspace.
		if (get().lastUsedWorkspace === cwd) return;
		// Fire-and-forget IPC. Main persists, then broadcasts `state:changed`
		// to every other window (skip-self) which triggers their refetch.
		void window.claude?.setLastUsedWorkspace(cwd);
		set({ lastUsedWorkspace: cwd });
	},
	setSessionsSidebarWidth: (width) => {
		// Same pattern as setLastUsedWorkspace: no-op if unchanged, optimistic
		// local update, fire-and-forget IPC. Called from the resize-divider
		// drop handler so it fires once per drag, not per pointer move.
		if (get().sessionsSidebarWidth === width) return;
		void window.claude?.setSessionsSidebarWidth(width);
		set({ sessionsSidebarWidth: width });
	},
}));
