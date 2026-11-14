import { create } from "zustand";
import type {
	TerminalInfo,
	TerminalStatus,
} from "@shared/schemas/terminals";

export const TERMINAL_DOT: Record<TerminalStatus, "gray" | "green" | "red"> = {
	idle: "gray",
	running: "green",
	crashed: "red",
};

export interface TerminalGroup {
	id: string;
	terminals: TerminalInfo[];
}

interface State {
	terminals: TerminalInfo[];
	openGroupId: string | null;
	focusId: string | null;
	setTerminals: (terminals: TerminalInfo[]) => void;
	refresh: () => Promise<void>;
	add: (cwd: string | undefined) => Promise<void>;
	split: (fromId: string) => Promise<void>;
	open: (groupId: string) => void;
	setFocus: (id: string) => void;
	close: () => void;
	kill: (id: string) => Promise<void>;
	killGroup: (groupId: string) => Promise<void>;
	stop: (id: string) => Promise<void>;
	rerun: (id: string) => Promise<void>;
	stopGroup: (groupId: string) => Promise<void>;
	rerunGroup: (groupId: string) => Promise<void>;
	renameGroup: (groupId: string, name: string) => Promise<void>;
	saveConfig: (groupId: string, name: string) => Promise<boolean>;
	loadConfig: (configId: string, groupId: string) => Promise<void>;
}

function withTerminal(
	terminals: TerminalInfo[],
	created: TerminalInfo,
): TerminalInfo[] {
	return terminals.some((t) => t.id === created.id)
		? terminals
		: [...terminals, created];
}

export const useTerminalsStore = create<State>((set, get) => ({
	terminals: [],
	openGroupId: null,
	focusId: null,
	setTerminals: (terminals) =>
		set((state) => ({
			terminals,
			openGroupId: terminals.some((t) => t.groupId === state.openGroupId)
				? state.openGroupId
				: null,
		})),
	refresh: async () => {
		get().setTerminals(await window.claude.listTerminals());
	},
	add: async (cwd) => {
		const created = await window.claude.createTerminal(cwd);
		if (!created) return;
		set((state) => ({
			terminals: withTerminal(state.terminals, created),
			openGroupId: created.groupId,
			focusId: created.id,
		}));
	},
	split: async (fromId) => {
		const created = await window.claude.createTerminal(undefined, fromId);
		if (!created) return;
		set((state) => ({
			terminals: withTerminal(state.terminals, created),
			focusId: created.id,
		}));
	},
	open: (groupId) => set({ openGroupId: groupId, focusId: null }),
	setFocus: (id) => set({ focusId: id }),
	close: () => set({ openGroupId: null, focusId: null }),
	kill: async (id) => {
		await window.claude.killTerminal(id);
	},
	killGroup: async (groupId) => {
		await window.claude.killTerminalGroup(groupId);
	},
	stop: async (id) => {
		await window.claude.stopTerminal(id);
	},
	rerun: async (id) => {
		await window.claude.rerunTerminal(id);
	},
	stopGroup: async (groupId) => {
		await window.claude.stopTerminalGroup(groupId);
	},
	rerunGroup: async (groupId) => {
		await window.claude.rerunTerminalGroup(groupId);
	},
	renameGroup: async (groupId, name) => {
		await window.claude.renameTerminalGroup(groupId, name);
	},
	saveConfig: async (groupId, name) =>
		(await window.claude.saveTerminalConfig(groupId, name)) !== null,
	loadConfig: async (configId, groupId) => {
		const loadedGroupId = await window.claude.loadTerminalConfig(
			configId,
			groupId,
		);
		if (!loadedGroupId) return;
		set({ openGroupId: loadedGroupId, focusId: null });
		await get().refresh();
	},
}));

export function groupTerminals(terminals: TerminalInfo[]): TerminalGroup[] {
	const groups = new Map<string, TerminalInfo[]>();
	for (const terminal of terminals) {
		const members = groups.get(terminal.groupId) ?? [];
		members.push(terminal);
		groups.set(terminal.groupId, members);
	}
	return [...groups.entries()].map(([id, members]) => ({
		id,
		terminals: members.sort((a, b) => a.createdAt - b.createdAt),
	}));
}

export function groupStatus(group: TerminalGroup): TerminalStatus {
	const statuses = group.terminals.map((t) => t.status);
	if (statuses.includes("crashed")) return "crashed";
	if (statuses.includes("running")) return "running";
	return "idle";
}

export function groupLastLine(group: TerminalGroup): string {
	let latest: TerminalInfo | undefined;
	for (const terminal of group.terminals) {
		if (!terminal.lastLine) continue;
		if (!latest || terminal.lastLineAt > latest.lastLineAt) latest = terminal;
	}
	return latest?.lastLine ?? "";
}

export function groupLabel(group: TerminalGroup): string {
	const first = group.terminals[0];
	if (!first) return "";
	return first.name ?? folderName(first.cwd);
}

export function folderName(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() ?? "/";
}
