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
	defaultModel?: string;
	sessionsSidebarWidth?: number;
	notesSidebarWidth?: number;
	sidequestSidebarWidth?: number;
	hydrate: (settings: AppSettingsFile) => void;
	setLastUsedWorkspace: (cwd: string) => void;
	setDefaultModel: (model: string | undefined) => void;
	setSessionsSidebarWidth: (width: number) => void;
	setNotesSidebarWidth: (width: number) => void;
	setSidequestSidebarWidth: (width: number) => void;
}

export const useSettingsStore = create<State>((set, get) => ({
	lastUsedWorkspace: undefined,
	defaultModel: undefined,
	sessionsSidebarWidth: undefined,
	notesSidebarWidth: undefined,
	sidequestSidebarWidth: undefined,
	hydrate: (settings) =>
		set({
			lastUsedWorkspace: settings.lastUsedWorkspace,
			defaultModel: settings.defaultModel,
			sessionsSidebarWidth: settings.sessionsSidebarWidth,
			notesSidebarWidth: settings.notesSidebarWidth,
			sidequestSidebarWidth: settings.sidequestSidebarWidth,
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
	setDefaultModel: (model) => {
		if (get().defaultModel === model) return;
		void window.claude?.setDefaultModel(model);
		set({ defaultModel: model });
	},
	setSessionsSidebarWidth: (width) => {
		// Same pattern as setLastUsedWorkspace: no-op if unchanged, optimistic
		// local update, fire-and-forget IPC. Called from the resize-divider
		// drop handler so it fires once per drag, not per pointer move.
		if (get().sessionsSidebarWidth === width) return;
		void window.claude?.setSessionsSidebarWidth(width);
		set({ sessionsSidebarWidth: width });
	},
	setNotesSidebarWidth: (width) => {
		if (get().notesSidebarWidth === width) return;
		void window.claude?.setNotesSidebarWidth(width);
		set({ notesSidebarWidth: width });
	},
	setSidequestSidebarWidth: (width) => {
		if (get().sidequestSidebarWidth === width) return;
		void window.claude?.setSidequestSidebarWidth(width);
		set({ sidequestSidebarWidth: width });
	},
}));

/**
 * The app-wide default model a brand-new session starts on, or undefined
 * when the user hasn't set one (→ the CLI picks its own). Read
 * imperatively rather than as a hook: every caller is a zustand action or
 * an event handler running outside React's render cycle (createDraft, the
 * various New Session retarget sites).
 */
export function appDefaultModel(): string | undefined {
	return useSettingsStore.getState().defaultModel;
}
