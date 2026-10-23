import { create } from "zustand";

interface PendingSwitch {
	model: string | undefined;
	seq: number;
}

interface State {
	openForSessionId: string | null;
	switching: Record<string, PendingSwitch>;
	failed: Record<string, true>;
	open: (sessionId: string) => void;
	close: () => void;
	runSwitch: (
		sessionId: string,
		model: string | undefined,
		apply: () => Promise<void> | void,
	) => Promise<void>;
}

let switchSeq = 0;

function without<V>(record: Record<string, V>, key: string): Record<string, V> {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
}

export const useModelPickerStore = create<State>((set, get) => ({
	openForSessionId: null,
	switching: {},
	failed: {},
	open: (sessionId) =>
		set((s) => ({
			openForSessionId: sessionId,
			failed: without(s.failed, sessionId),
		})),
	close: () => set({ openForSessionId: null }),
	runSwitch: async (sessionId, model, apply) => {
		const seq = ++switchSeq;
		set((s) => ({
			switching: { ...s.switching, [sessionId]: { model, seq } },
			failed: without(s.failed, sessionId),
		}));
		const isLatest = () => get().switching[sessionId]?.seq === seq;
		try {
			await apply();
			if (isLatest()) {
				set((s) => ({ switching: without(s.switching, sessionId) }));
			}
		} catch (err) {
			console.error("[ccw] model switch failed:", err);
			if (isLatest()) {
				set((s) => ({
					switching: without(s.switching, sessionId),
					failed: { ...s.failed, [sessionId]: true },
				}));
			}
		}
	},
}));
