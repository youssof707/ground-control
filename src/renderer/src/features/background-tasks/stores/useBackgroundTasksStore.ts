import { create } from "zustand";

/**
 * Generic registry for fire-and-forget async work that shouldn't block a
 * modal or a button.
 *
 * The motivating case is worktree deletion: `worktrees:delete` shells out to
 * git up to four times and then does a recursive `fs.rm` (see
 * `worktreeRemove` in `main/sessions/worktrees.ts`), which kept the delete
 * confirm modal open for seconds. Anything with that shape belongs here.
 *
 *   running — the promise is in flight; the indicator shows a spinner
 *   error   — it rejected; the task STAYS in the list until the user
 *             dismisses it, so a failure is never silently swallowed
 *
 * Success is not a state: a resolved task is removed outright, so the
 * indicator disappears on its own with no user action.
 */
export type BackgroundTaskStatus = "running" | "error";

export interface BackgroundTask {
	id: string;
	/**
	 * Short, human-readable, and VISIBLY rendered next to the spinner (e.g.
	 * "Deleting worktree ucc-ff-change"). This repo has a hard no-tooltip
	 * rule, so the label is the only affordance explaining what's running —
	 * write it for a reader, not as a debug string.
	 */
	label: string;
	status: BackgroundTaskStatus;
	error: string | null;
}

interface State {
	tasks: BackgroundTask[];
	/** Drop a single finished-with-error task. */
	dismiss: (id: string) => void;
	/** Drop every errored task. Running tasks are left alone. */
	dismissAll: () => void;
}

export const useBackgroundTasksStore = create<State>((set) => ({
	tasks: [],
	dismiss: (id) =>
		set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
	dismissAll: () =>
		set((s) => ({ tasks: s.tasks.filter((t) => t.status !== "error") })),
}));

// Monotonic counter for task ids. These never leave memory and are never
// persisted, so a counter is enough — no need to reach for `ulid` here.
let seq = 0;

/**
 * Start a background task. Deliberately NOT async and returns void: callers
 * must not await it, and it never throws — every rejection is captured into
 * the store and surfaced by `BackgroundTasksIndicator`.
 *
 * `onSuccess` runs only when `run` resolves, which is the right place for
 * local cache updates that must not happen on failure (e.g. dropping a
 * worktree from `useWorktreesStore` — main KEEPS the registry entry when
 * removal fails so the user can retry).
 *
 * The store is module-level, so a task safely outlives the component that
 * started it; there's no unmount guard to get wrong.
 */
export function runBackgroundTask(opts: {
	label: string;
	run: () => Promise<unknown>;
	onSuccess?: () => void;
}): void {
	const id = `bg-${++seq}`;
	useBackgroundTasksStore.setState((s) => ({
		tasks: [
			...s.tasks,
			{ id, label: opts.label, status: "running", error: null },
		],
	}));

	void opts.run().then(
		() => {
			opts.onSuccess?.();
			useBackgroundTasksStore.setState((s) => ({
				tasks: s.tasks.filter((t) => t.id !== id),
			}));
		},
		(err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[ccw] background task failed (${opts.label}):`, err);
			useBackgroundTasksStore.setState((s) => ({
				tasks: s.tasks.map((t) =>
					t.id === id ? { ...t, status: "error", error: message } : t,
				),
			}));
		},
	);
}
