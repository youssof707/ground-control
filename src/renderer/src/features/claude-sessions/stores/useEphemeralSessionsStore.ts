import { create } from "zustand";
import type { SessionMode } from "@shared/claude-sessions/types";

/**
 * Ephemeral "draft" sessions live in the renderer only — there is NO
 * backend record, NO SDK loop, NO persistence. They exist as a UI shell
 * so the user can pick a folder, then choose to either:
 *   (a) send a first message — promotes to a real session in that folder.
 *   (b) link a worktree via the header chip — promotes to a real session
 *       in the worktree.
 *
 * The id is client-generated and used in the URL (`/sessions/<id>`).
 * SessionChat resolves either a real session (from useSessionsStore) or
 * an ephemeral one (this store). When a draft is promoted, the renderer
 * removes it from this store and navigates to the real session's id.
 *
 * Drafts do NOT survive a reload — they live in-memory by design. The
 * folder-picker remembers the last cwd, so re-clicking New Session
 * after a reload gets the user back to the same starting point.
 */
export interface EphemeralSession {
	id: string;
	title: string;
	cwd: string;
	mode: SessionMode;
	createdAt: number;
}

interface State {
	drafts: Record<string, EphemeralSession>;
	order: string[];
	create: (
		cwd: string,
		title: string,
		mode?: SessionMode,
	) => EphemeralSession;
	remove: (id: string) => void;
	get: (id: string) => EphemeralSession | undefined;
}

function uuid(): string {
	// `crypto.randomUUID` exists in modern Electron renderers (Chromium >= 92).
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	// Fallback for older runtimes — same shape, less entropy guarantees,
	// but only used as a UUID for renderer-local routing so it's fine.
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export const useEphemeralSessionsStore = create<State>((set, getStore) => ({
	drafts: {},
	order: [],
	create: (cwd, title, mode = "plan") => {
		const draft: EphemeralSession = {
			id: uuid(),
			title,
			cwd,
			mode,
			createdAt: Date.now(),
		};
		set((s) => ({
			drafts: { ...s.drafts, [draft.id]: draft },
			order: [...s.order, draft.id],
		}));
		return draft;
	},
	remove: (id) =>
		set((s) => {
			if (!s.drafts[id]) return s;
			const { [id]: _removed, ...rest } = s.drafts;
			void _removed;
			return {
				drafts: rest,
				order: s.order.filter((x) => x !== id),
			};
		}),
	get: (id) => getStore().drafts[id],
}));
