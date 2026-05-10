import { create } from "zustand";
import type {
	ClaudeSessionFull,
	SessionMessage,
	SessionStatus,
} from "@shared/claude-sessions/types";

interface State {
	sessions: Record<string, ClaudeSessionFull>;
	order: string[];
	upsertSession: (s: Partial<ClaudeSessionFull> & { id: string }) => void;
	appendMessage: (sessionId: string, msg: SessionMessage) => void;
	setStatus: (sessionId: string, status: SessionStatus) => void;
}

export const useSessionsStore = create<State>((set) => ({
	sessions: {},
	order: [],
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
}));
