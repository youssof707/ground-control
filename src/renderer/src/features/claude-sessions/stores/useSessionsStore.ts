import { create } from "zustand";
import type {
	ClaudeSessionFull,
	SessionMessage,
	SessionStatus,
} from "@shared/claude-sessions/types";

interface State {
	sessions: Record<string, ClaudeSessionFull>;
	order: string[];
	hydrated: boolean;
	upsertSession: (s: Partial<ClaudeSessionFull> & { id: string }) => void;
	appendMessage: (sessionId: string, msg: SessionMessage) => void;
	setStatus: (sessionId: string, status: SessionStatus) => void;
	removeSession: (sessionId: string) => void;
	hydrate: (sessions: ClaudeSessionFull[]) => void;
}

export const useSessionsStore = create<State>((set) => ({
	sessions: {},
	order: [],
	hydrated: false,
	upsertSession: (s) =>
		set((st) => {
			const existing = st.sessions[s.id];
			const merged: ClaudeSessionFull = {
				...(existing ?? { messages: [] }),
				...s,
			} as ClaudeSessionFull;
			return {
				sessions: { ...st.sessions, [s.id]: merged },
				order: st.order.includes(s.id) ? st.order : [...st.order, s.id],
			};
		}),
	appendMessage: (sessionId, msg) =>
		set((st) => {
			const sess = st.sessions[sessionId];
			if (!sess) return st;
			return {
				sessions: {
					...st.sessions,
					[sessionId]: { ...sess, messages: [...sess.messages, msg] },
				},
			};
		}),
	setStatus: (sessionId, status) =>
		set((st) => {
			const sess = st.sessions[sessionId];
			if (!sess) return st;
			return {
				sessions: { ...st.sessions, [sessionId]: { ...sess, status } },
			};
		}),
	removeSession: (sessionId) =>
		set((st) => {
			if (!st.sessions[sessionId]) return st;
			const { [sessionId]: _removed, ...rest } = st.sessions;
			void _removed;
			return {
				sessions: rest,
				order: st.order.filter((id) => id !== sessionId),
			};
		}),
	hydrate: (sessions) =>
		set(() => {
			const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
			const map: Record<string, ClaudeSessionFull> = {};
			const order: string[] = [];
			for (const s of sorted) {
				map[s.id] = s;
				order.push(s.id);
			}
			return { sessions: map, order, hydrated: true };
		}),
}));
