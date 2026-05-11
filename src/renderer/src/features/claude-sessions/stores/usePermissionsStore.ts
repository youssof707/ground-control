import { create } from "zustand";
import type { PermissionRequest } from "@shared/claude-sessions/types";

interface State {
	queue: PermissionRequest[];
	enqueue: (r: PermissionRequest) => void;
	remove: (requestId: string) => void;
	removeBySessionId: (sessionId: string) => void;
}

export const usePermissionsStore = create<State>((set) => ({
	queue: [],
	enqueue: (r) =>
		set((s) => {
			if (s.queue.some((q) => q.requestId === r.requestId)) return s;
			return { queue: [...s.queue, r] };
		}),
	remove: (requestId) =>
		set((s) => ({
			queue: s.queue.filter((q) => q.requestId !== requestId),
		})),
	removeBySessionId: (sessionId) =>
		set((s) => ({
			queue: s.queue.filter((q) => q.sessionId !== sessionId),
		})),
}));
