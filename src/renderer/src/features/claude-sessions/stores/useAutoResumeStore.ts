import { create } from "zustand";

interface State {
	resumeAtBySession: Record<string, number>;
	hydrate: (resumeAtBySession: Record<string, number>) => void;
	apply: (sessionId: string, resumeAt: number | null) => void;
}

export const useAutoResumeStore = create<State>((set) => ({
	resumeAtBySession: {},
	hydrate: (resumeAtBySession) => set({ resumeAtBySession }),
	apply: (sessionId, resumeAt) =>
		set((s) => {
			if (resumeAt !== null) {
				return {
					resumeAtBySession: { ...s.resumeAtBySession, [sessionId]: resumeAt },
				};
			}
			if (!(sessionId in s.resumeAtBySession)) return s;
			const next = { ...s.resumeAtBySession };
			delete next[sessionId];
			return { resumeAtBySession: next };
		}),
}));

export function formatResumeLabel(resumeAt: number): string {
	const time = new Date(resumeAt)
		.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		.replace(/\s/g, "")
		.toLowerCase();
	return `resumes ${time}`;
}
