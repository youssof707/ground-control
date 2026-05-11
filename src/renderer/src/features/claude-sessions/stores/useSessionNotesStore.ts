import { create } from "zustand";
import type { Note } from "@shared/schemas/session_notes";

/**
 * Per-session notes cache. Source of truth lives in the main process
 * (`session_notes.json`); this store is a thin in-memory mirror that:
 *   - hydrates lazily on `SessionNotesPanel` mount (per session, not global),
 *   - re-hydrates on `state:changed` pings (panel-scoped subscription),
 *   - applies optimistic local writes for create/update/delete so the
 *     editor never feels laggy.
 *
 * `inFlight` is the critical guard: if the user is typing in note X and a
 * refetch arrives (e.g. another window just saved a sibling note), we must
 * NOT overwrite X's local markdown with disk's stale value. Each
 * `updateNote` call adds X to `inFlight` and removes it after the IPC
 * resolves. `hydrateForSession` skips any in-flight note. A belt-and-braces
 * check also keeps the local copy if its `updatedAt` is newer than disk's.
 */
interface State {
	notesBySession: Record<string, Note[]>;
	inFlight: Set<string>;
	hydrateForSession: (sessionId: string, notes: Note[]) => void;
	createNote: (sessionId: string) => Promise<Note>;
	updateNote: (id: string, markdown: string) => Promise<void>;
	deleteNote: (id: string) => Promise<void>;
}

// Newest first, ULID tiebreaker for ties on the same millisecond.
function sortNotes(notes: Note[]): Note[] {
	return [...notes].sort((a, b) => {
		if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
		return b.id.localeCompare(a.id);
	});
}

function findNote(
	notesBySession: Record<string, Note[]>,
	id: string,
): { sessionId: string; note: Note } | null {
	for (const sessionId of Object.keys(notesBySession)) {
		const note = notesBySession[sessionId].find((n) => n.id === id);
		if (note) return { sessionId, note };
	}
	return null;
}

export const useSessionNotesStore = create<State>((set, get) => ({
	notesBySession: {},
	inFlight: new Set(),

	hydrateForSession: (sessionId, notes) =>
		set((st) => {
			const local = st.notesBySession[sessionId] ?? [];
			const localById = new Map(local.map((n) => [n.id, n]));
			const merged: Note[] = [];
			for (const incoming of notes) {
				const localCopy = localById.get(incoming.id);
				// Skip overwrite if (a) the note is in-flight (user editing right
				// now), or (b) the local copy is strictly newer than disk's. Both
				// avoid clobbering local edits with a slightly-stale refetch.
				if (
					localCopy &&
					(st.inFlight.has(incoming.id) ||
						localCopy.updatedAt > incoming.updatedAt)
				) {
					merged.push(localCopy);
				} else {
					merged.push(incoming);
				}
			}
			return {
				notesBySession: {
					...st.notesBySession,
					[sessionId]: sortNotes(merged),
				},
			};
		}),

	createNote: async (sessionId) => {
		// Server-authoritative ID — wait for main to return the full note,
		// then insert. No optimistic placeholder (a transient empty note
		// would just confuse the empty-state UI).
		const note = await window.claude.createNote(sessionId);
		set((st) => {
			const existing = st.notesBySession[sessionId] ?? [];
			return {
				notesBySession: {
					...st.notesBySession,
					[sessionId]: sortNotes([note, ...existing]),
				},
			};
		});
		return note;
	},

	updateNote: async (id, markdown) => {
		const found = findNote(get().notesBySession, id);
		if (!found) return;
		// Optimistic: bump local markdown + updatedAt immediately so any
		// concurrent hydrate sees a newer local copy and skips it.
		const next: Note = { ...found.note, markdown, updatedAt: Date.now() };
		set((st) => {
			const nextInFlight = new Set(st.inFlight);
			nextInFlight.add(id);
			return {
				inFlight: nextInFlight,
				notesBySession: {
					...st.notesBySession,
					[found.sessionId]: st.notesBySession[found.sessionId].map((n) =>
						n.id === id ? next : n,
					),
				},
			};
		});
		try {
			await window.claude.updateNote(id, markdown);
		} finally {
			set((st) => {
				if (!st.inFlight.has(id)) return st;
				const nextInFlight = new Set(st.inFlight);
				nextInFlight.delete(id);
				return { inFlight: nextInFlight };
			});
		}
	},

	deleteNote: async (id) => {
		const found = findNote(get().notesBySession, id);
		if (!found) return;
		// Optimistic removal; if IPC fails the next refetch will re-add it.
		set((st) => {
			const nextInFlight = new Set(st.inFlight);
			nextInFlight.delete(id);
			return {
				inFlight: nextInFlight,
				notesBySession: {
					...st.notesBySession,
					[found.sessionId]: st.notesBySession[found.sessionId].filter(
						(n) => n.id !== id,
					),
				},
			};
		});
		await window.claude.deleteNote(id);
	},
}));
