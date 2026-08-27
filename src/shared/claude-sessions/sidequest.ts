/**
 * Sidequest id helpers, shared by both processes.
 *
 * A sidequest is an ephemeral fork of a main session (see
 * `useSidequestsStore`). Its id never appears in `claude_sessions.json`, so
 * any code path that would *write* to the session store or broadcast on a
 * `session:*` channel has to be able to recognise one and bail — the
 * renderer's `upsertSession` lazy-creates rows, so a single leaked write
 * mints a phantom sidebar entry.
 *
 * Main-side mutators (`setMode`, `setModel`) can normally detect this from
 * the `RunningEntry.ephemeral` flag, but that flag is gone once the SDK loop
 * has torn down — and a late IPC call from a panel that's still on screen
 * would then fall straight through to the persist path. The id prefix is the
 * one piece of evidence that outlives the entry.
 */

export const SIDEQUEST_ID_PREFIX = "sidequest-";

export function isSidequestId(id: string | undefined | null): id is string {
	return !!id && id.startsWith(SIDEQUEST_ID_PREFIX);
}

export function newSidequestId(): string {
	return `${SIDEQUEST_ID_PREFIX}${crypto.randomUUID()}`;
}
