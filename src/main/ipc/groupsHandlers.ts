import { ipcMain } from "electron";
import { ulid } from "ulid";
import * as groupsStore from "../core/store/session_groups";
import * as sessionStore from "../core/store/claude_session";
import { broadcast } from "../windows";
import type { CreateSessionGroupInput } from "../../shared/schemas/session_groups";

/**
 * IPC surface for sidebar session groups. Mirrors the worktreesHandlers
 * structure — one `register*Handlers()` per feature, called from
 * `registerSessionsHandlers` at boot.
 *
 * Membership is stored on the session (`session.groupId`), not on the
 * group — see the session_groups store header. Group records mutate here
 * (create / collapse / auto-delete); membership mutates via
 * `groups:setSessionGroup` and via the session-delete cascade in
 * sessionsHandlers, both of which call `pruneGroupIfEmpty` afterwards.
 * Archiving does NOT touch membership — archived members still count,
 * so an all-archived group survives (hidden, not deleted).
 */

/**
 * Auto-delete a group the moment it has zero members. Called after every
 * mutation that can empty a group (remove-from-group, move-to-other-group,
 * session delete). Archived sessions count as members — archiving hides
 * a row, it doesn't evict it from its group.
 *
 * The `state:changed` broadcast is deliberately NOT skip-self: the prune is
 * a cascade the originating window didn't ask for by name (it asked to
 * delete a session, say), so it can't learn about the group deletion from
 * its invoke response — every window re-hydrates its groups store instead.
 */
export async function pruneGroupIfEmpty(groupId: string): Promise<void> {
	const hasMembers = sessionStore
		.listSessions()
		.some((s) => s.groupId === groupId);
	if (hasMembers) return;
	const removed = await groupsStore.remove(groupId);
	if (removed) broadcast("state:changed", undefined);
}

export function registerGroupsHandlers(): void {
	ipcMain.handle("groups:list", () => groupsStore.list());

	ipcMain.handle(
		"groups:create",
		async (e, input: CreateSessionGroupInput) => {
			const name = input.name.trim();
			if (!name) throw new Error("Group name is required");
			const group = await groupsStore.create({
				id: ulid(),
				name,
				color: input.color,
				createdAt: Date.now(),
				collapsed: false,
			});
			// Skip-self: the originator upserts its local store from the
			// invoke response (AddToGroupModal), same as worktrees:create.
			broadcast("state:changed", undefined, e.sender.id);
			return group;
		},
	);

	ipcMain.handle(
		"groups:setCollapsed",
		async (e, payload: { groupId: string; collapsed: boolean }) => {
			// Missing group → silent no-op: the toggle can race an
			// auto-delete from another window, and there's nothing useful
			// to tell the user about a group that just ceased to exist.
			await groupsStore.setCollapsed(payload.groupId, payload.collapsed);
			broadcast("state:changed", undefined, e.sender.id);
		},
	);

	ipcMain.handle(
		"groups:rename",
		async (e, payload: { groupId: string; name: string }) => {
			const name = payload.name.trim();
			if (!name) throw new Error("Group name is required");
			// Silent no-op on missing group — mirrors setCollapsed: a rename
			// can race an auto-delete from another window, and the modal's
			// error slot handles the "group vanished" edge if we need it.
			await groupsStore.setName(payload.groupId, name);
			broadcast("state:changed", undefined, e.sender.id);
		},
	);

	ipcMain.handle(
		"groups:setSessionGroup",
		async (
			e,
			payload: { sessionId: string; groupId: string | null },
		) => {
			const { sessionId, groupId } = payload;
			// Reject joins to a group that vanished (auto-deleted from
			// another window while the modal sat open). The modal surfaces
			// this in its error slot and the un-skipped prune broadcast has
			// already queued a refetch that drops the stale row.
			if (groupId != null && !groupsStore.get(groupId)) {
				throw new Error("That group no longer exists.");
			}
			const prior = sessionStore.getSession(sessionId)?.groupId;
			const updated = await sessionStore.updateSession(sessionId, {
				groupId: groupId ?? undefined,
			});
			if (!updated) throw new Error("Session not found");
			// Same clear-an-optional-field pattern as session:unarchive:
			// structured-clone IPC preserves explicit `undefined`, so
			// upsertSession's spread-merge genuinely clears the field on
			// every window (including the originator).
			broadcast("session:patch", {
				sessionId,
				groupId: groupId ?? undefined,
			});
			if (prior && prior !== groupId) await pruneGroupIfEmpty(prior);
			// Safety-net structural ping for windows that missed the patch.
			broadcast("state:changed", undefined, e.sender.id);
		},
	);
}
