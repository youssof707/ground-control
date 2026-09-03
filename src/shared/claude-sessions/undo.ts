import type { ClaudeSessionFull } from "../schemas/claude_session";
import type { Note } from "../schemas/session_notes";
import type { SessionGroup } from "../schemas/session_groups";

/**
 * Everything `session:delete` destroys, handed back to the renderer so it can
 * be put again by `session:restore`.
 *
 * Deleting a session is not a single-row operation — `session:delete` also
 * cascade-deletes the session's notes, detaches it from its worktree, and
 * auto-deletes its sidebar group if it was that group's last member. A
 * restore that only brought back the session row would be a *partial*
 * resurrection: the user would believe they were made whole while their notes
 * and their group stayed gone. So the delete handler captures all of it here,
 * before it starts destroying things, and hands the whole snapshot back as its
 * return value.
 *
 * The snapshot lives only in renderer memory (`useUndoStore`) and is never
 * persisted — quitting the app is what ends the undo window. See
 * `src/renderer/src/features/claude-sessions/stores/useUndoStore.ts`.
 */
export interface DeletedSessionSnapshot {
	/** The full session record as it was immediately before deletion. */
	session: ClaudeSessionFull;
	/** Every note that the delete cascade removed. Often empty. */
	notes: Note[];
	/**
	 * The session's sidebar group, but ONLY when the delete auto-pruned it
	 * (i.e. this session was its last member). Null when the group survived —
	 * in that case `session.groupId` still points at a live record and there's
	 * nothing to re-create.
	 */
	prunedGroup: SessionGroup | null;
	/**
	 * Set by the RENDERER, not by main: true when the user also ticked "Also
	 * delete worktree", so the checkout was destroyed on disk by the cascading
	 * `worktrees:delete`.
	 *
	 * A recursive `fs.rm` is not undoable, so restore deliberately drops the
	 * session's `worktreeId` when this is set rather than handing back a row
	 * whose `WorktreeChip` points at a directory that no longer exists.
	 */
	worktreeDeleted?: boolean;
}
