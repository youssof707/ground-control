import { create } from "zustand";
import type { PermissionRequest } from "@shared/claude-sessions/types";

interface State {
	queue: PermissionRequest[];
	enqueue: (r: PermissionRequest) => void;
	remove: (requestId: string) => void;
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
}));
