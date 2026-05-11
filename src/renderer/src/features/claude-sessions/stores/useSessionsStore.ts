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
	// Ids the renderer has deleted. Defense-in-depth: even if a stale event
	// slipped through the main-side tombstone filter (or arrived on a
	// window that never had the row), upsert / append / setStatus refuse
	// to resurrect a deleted id. Kept across hydrate() so a late event
	// arriving after the post-`state:changed` refetch is still gated.
	deletedIds: Set<string>;
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
	deletedIds: new Set<string>(),
	upsertSession: (s) =>
		set((st) => {
			// Closes the lazy-create resurrection path: without this, a late
			// session:status / session:cancelled / session:patch for a just-
			// deleted id would mint a fresh row with `{ messages: [] }` and
			// render as a ghost ("Waiting for first message…").
			if (st.deletedIds.has(s.id)) return st;
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
			if (st.deletedIds.has(sessionId)) return st;
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
			if (st.deletedIds.has(sessionId)) return st;
			const sess = st.sessions[sessionId];
			if (!sess) return st;
			return {
				sessions: { ...st.sessions, [sessionId]: { ...sess, status } },
			};
		}),
	removeSession: (sessionId) =>
		set((st) => {
			// Always record the tombstone, even if the row isn't currently in
			// the map — protects against a late event arriving after a
			// hydrate that already excluded the deleted row.
			const nextDeleted = new Set(st.deletedIds);
			nextDeleted.add(sessionId);
			if (!st.sessions[sessionId]) {
				return { ...st, deletedIds: nextDeleted };
			}
			const { [sessionId]: _removed, ...rest } = st.sessions;
			void _removed;
			return {
				sessions: rest,
				order: st.order.filter((id) => id !== sessionId),
				deletedIds: nextDeleted,
			};
		}),
	hydrate: (sessions) =>
		set((st) => {
			const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
			const map: Record<string, ClaudeSessionFull> = {};
			const order: string[] = [];
			for (const s of sorted) {
				// Honor the local tombstone if a stale list response somehow
				// still includes a deleted id (shouldn't happen with main-side
				// tombstones in place, but cheap to defend).
				if (st.deletedIds.has(s.id)) continue;
				map[s.id] = s;
				order.push(s.id);
			}
			return { sessions: map, order, hydrated: true };
		}),
}));
