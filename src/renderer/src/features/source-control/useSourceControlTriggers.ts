import { useEffect } from "react";
import { useDraftSessionsStore } from "../claude-sessions/stores/useDraftSessionsStore";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { useSourceControlStore } from "./useSourceControlStore";

type SessionsState = ReturnType<typeof useSessionsStore.getState>;
type DraftState = ReturnType<typeof useDraftSessionsStore.getState>;

export function useSourceControlTriggers(): void {
	useEffect(() => {
		let cancelled = false;
		let startupStarted = false;
		let lastOrder: unknown = null;
		let lastDraftId: string | null = null;
		const known = new Set<string>();

		const refresh = (cwd: string): Promise<void> =>
			useSourceControlStore
				.getState()
				.refresh(cwd)
				.catch(() => undefined);

		const runStartup = async (state: SessionsState): Promise<void> => {
			const roots = new Set<string>();
			for (const id of state.order) {
				const cwd = state.sessions[id]?.cwd;
				if (!cwd) continue;
				known.add(id);
				roots.add(cwd);
			}
			for (const cwd of roots) {
				if (cancelled) return;
				await refresh(cwd);
			}
		};

		const onSessions = (state: SessionsState): void => {
			try {
				if (!state.hydrated) return;
				if (!startupStarted) {
					startupStarted = true;
					lastOrder = state.order;
					void runStartup(state);
					return;
				}
				if (state.order === lastOrder) return;
				lastOrder = state.order;
				for (const id of state.order) {
					if (known.has(id)) continue;
					const cwd = state.sessions[id]?.cwd;
					if (!cwd) continue;
					known.add(id);
					void refresh(cwd);
				}
			} catch {
				return;
			}
		};

		const onDraft = (state: DraftState): void => {
			try {
				const draft = state.draft;
				if (!draft) {
					lastDraftId = null;
					return;
				}
				if (draft.id === lastDraftId) return;
				lastDraftId = draft.id;
				if (draft.cwd) void refresh(draft.cwd);
			} catch {
				return;
			}
		};

		onSessions(useSessionsStore.getState());
		onDraft(useDraftSessionsStore.getState());
		const unsubscribeSessions = useSessionsStore.subscribe(onSessions);
		const unsubscribeDraft = useDraftSessionsStore.subscribe(onDraft);

		return () => {
			cancelled = true;
			unsubscribeSessions();
			unsubscribeDraft();
		};
	}, []);
}
