import type { CreateWorktreeInput } from "@shared/schemas/worktrees";
import {
	currentDraft,
	useDraftSessionsStore,
	type DraftAction,
} from "../stores/useDraftSessionsStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";

const inFlight = new Map<string, Promise<void>>();
let seq = 0;

function updateActions(
	draftId: string,
	update: (actions: DraftAction[]) => DraftAction[],
): void {
	const draft = currentDraft(draftId);
	if (!draft) return;
	useDraftSessionsStore
		.getState()
		.updateDraft({ pendingActions: update(draft.pendingActions) });
}

function isListed(draftId: string, actionId: string): boolean {
	return !!currentDraft(draftId)?.pendingActions.some((a) => a.id === actionId);
}

function removeAction(draftId: string, actionId: string): void {
	updateActions(draftId, (actions) => actions.filter((a) => a.id !== actionId));
}

function failAction(draftId: string, actionId: string, err: unknown): void {
	if (!isListed(draftId, actionId)) {
		console.error("[ccw] draft action failed after its draft moved on:", err);
		return;
	}
	const message = err instanceof Error ? err.message : String(err);
	updateActions(draftId, (actions) =>
		actions.map((a) =>
			a.id === actionId ? { ...a, status: "error", error: message } : a,
		),
	);
}

export function startDraftAction(
	draftId: string,
	action: Omit<DraftAction, "id" | "status" | "error">,
	run: (ctx: { isListed: () => boolean }) => Promise<void>,
): void {
	const id = `da-${++seq}`;
	updateActions(draftId, (actions) => [
		...actions,
		{ ...action, id, status: "running", error: null } as DraftAction,
	]);
	const settled = run({ isListed: () => isListed(draftId, id) })
		.then(
			() => removeAction(draftId, id),
			(err: unknown) => failAction(draftId, id, err),
		)
		.finally(() => inFlight.delete(id));
	inFlight.set(id, settled);
}

export async function awaitDraftActions(draftId: string): Promise<void> {
	const draft = currentDraft(draftId);
	if (!draft) return;
	await Promise.all(draft.pendingActions.map((a) => inFlight.get(a.id)));
	const failed = currentDraft(draftId)?.pendingActions.find(
		(a) => a.status === "error",
	);
	if (failed) throw new Error(failed.error ?? "Background action failed");
}

export function dismissDraftAction(draftId: string, actionId: string): void {
	removeAction(draftId, actionId);
}

export function startCreateWorktreeAction(
	draftId: string,
	input: CreateWorktreeInput,
): void {
	startDraftAction(
		draftId,
		{
			kind: "create-worktree",
			displayName: input.displayName,
			color: input.color,
		},
		async ({ isListed }) => {
			const worktree = await window.claude.createWorktree(input);
			useWorktreesStore.getState().upsert(worktree);
			if (isListed() && currentDraft(draftId)?.cwd === worktree.baseDir) {
				useDraftSessionsStore
					.getState()
					.updateDraft({ worktreeId: worktree.id });
			}
		},
	);
}
