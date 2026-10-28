import { create } from "zustand";

export type SettingsTab = "general" | "babysitter" | "mcp" | "developer";

interface State {
	openTab: SettingsTab | null;
	mcpCwd: string | null;
	open: (tab?: SettingsTab, mcpCwd?: string | null) => void;
	close: () => void;
}

export const useSettingsModalStore = create<State>((set) => ({
	openTab: null,
	mcpCwd: null,
	open: (tab = "general", mcpCwd = null) => set({ openTab: tab, mcpCwd }),
	close: () => set({ openTab: null, mcpCwd: null }),
}));
