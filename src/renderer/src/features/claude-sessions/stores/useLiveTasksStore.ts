import { create } from "zustand";
import type { LiveBackgroundTask } from "@shared/claude-sessions/types";

interface State {
	/**
	 * Live CLI background tasks (dev servers, background shells, subagents)
	 * per session. Keyed by plain id, so sessions and ephemeral sidequests
	 * share the map with no `byParent` indirection — same reasoning as
	 * `useInterruptStore`.
	 *
	 * Live-only mirror of main's `SessionActivity.liveTasks`, fed by the
	 * `session:tasks` / `sidequest:tasks` broadcasts and re-primed on
	 * bootstrap via `window.claude.listTasks`. Never persisted.
	 */
	tasks: Record<string, LiveBackgroundTask[]>;
	/**
	 * Task ids with a stop request in flight — the re-entrancy guard for the
	 * chip's Stop buttons. Rows are NOT removed optimistically: the
	 * `task_notification{stopped}` round-trip is the source of truth, and
	 * this flag covers the latency with a spinner.
	 */
	stopping: Record<string, boolean>;
	set: (sessionId: string, list: LiveBackgroundTask[]) => void;
	clear: (sessionId: string) => void;
	beginStop: (taskId: string) => void;
	endStop: (taskId: string) => void;
}

export const useLiveTasksStore = create<State>((set) => ({
	tasks: {},
	stopping: {},
	set: (sessionId, list) =>
		set((s) => {
			// Delete-on-empty keeps the map from growing a tombstone per
			// session for the lifetime of the app (same as useInterruptStore).
			const next = { ...s.tasks };
			if (list.length === 0) delete next[sessionId];
			else next[sessionId] = list;
			return { tasks: next };
		}),
	clear: (sessionId) =>
		set((s) => {
			if (!(sessionId in s.tasks)) return s;
			const next = { ...s.tasks };
			delete next[sessionId];
			return { tasks: next };
		}),
	beginStop: (taskId) =>
		set((s) => ({ stopping: { ...s.stopping, [taskId]: true } })),
	endStop: (taskId) =>
		set((s) => {
			const next = { ...s.stopping };
			delete next[taskId];
			return { stopping: next };
		}),
}));
