import { create } from "zustand";

const STORAGE_KEY = "ccw.readState.v1";

function load(): Record<string, number> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, number>;
		}
	} catch {
		// ignore
	}
	return {};
}

function save(state: Record<string, number>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// ignore
	}
}

interface State {
	lastReadAt: Record<string, number>;
	markRead: (sessionId: string, ts?: number) => void;
}

export const useReadStore = create<State>((set) => ({
	lastReadAt: load(),
	markRead: (sessionId, ts) =>
		set((s) => {
			const next = ts ?? Date.now();
			if ((s.lastReadAt[sessionId] ?? 0) >= next) return s;
			const updated = { ...s.lastReadAt, [sessionId]: next };
			save(updated);
			return { lastReadAt: updated };
		}),
}));
