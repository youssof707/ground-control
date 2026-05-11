import { create } from "zustand";

/**
 * Per-session "minimized" flag for the inline permission cards in the
 * sessions list. **In-memory only** — state resets on app launch, which is
 * intentional: the main sessions list defaults rows to minimized, so the
 * worst-case "lost" state is that a previously-expanded row goes back to its
 * default. No IPC, no JSON file, no cross-window sync.
 *
 * The store always records the explicit boolean (no delete-on-false trick)
 * because the caller's default lookup is `?? true` for some surfaces and
 * `?? false` for others — letting "absent key" mean a specific value would
 * break one of them.
 */
interface State {
	minimized: Record<string, boolean>;
	setMinimized: (sessionId: string, value: boolean) => void;
}

export const useMinimizedPermissionsStore = create<State>((set) => ({
	minimized: {},
	setMinimized: (sessionId, value) =>
		set((s) =>
			s.minimized[sessionId] === value
				? s
				: { minimized: { ...s.minimized, [sessionId]: value } },
		),
}));
