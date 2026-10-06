import type { NavigateFunction } from "react-router-dom";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { appendPromptBlock } from "./composerActions";
import { useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { appDefaultModel, useSettingsStore } from "../stores/useSettingsStore";

/**
 * Imperative "start a new session from a shortcut/skill" operations,
 * extracted from `SessionsList`'s `startFromShortcut`/`startFromSkill` so
 * the global Cmd+K palette (`CommandPaletteModal`, mounted outside
 * `SessionsList`'s component tree) can trigger the exact same flow the
 * sidebar's own ⚡ button does. Store-only aside from `navigate`, which
 * both call sites already have as a hook value in scope.
 *
 * `onWorkspaceRevealed` is optional: `SessionsList` uses it to keep a newly
 * spawned draft visible when its own `workspaceFilter` narrows the sidebar
 * to a different workspace (see its call site). The global palette has no
 * such local filter state to reconcile, so it just omits the callback —
 * the new draft still opens and navigates correctly, it just might not be
 * the workspace the sidebar filter happens to be narrowed to.
 */
interface StartOptions {
	/** Resolved "New Session" target cwd — see `SessionsList`'s `targetCwd`. */
	targetCwd: string | null;
	onWorkspaceRevealed?: (cwd: string) => void;
}

async function resolveDraftCwd(targetCwd: string | null): Promise<string | null> {
	const resolved = targetCwd ?? (await window.claude.pickFolder());
	if (!resolved) return null;
	useSettingsStore.getState().setLastUsedWorkspace(resolved);
	return resolved;
}

/**
 * Plain "New Session" — the shared implementation behind both the sidebar
 * button and the global Cmd+N hotkey, so the two can't drift.
 *
 * The draft starts clean: the target workspace folder, but no worktree and
 * no group. It's marked `floating` so its sidebar row sits at the top of the
 * list rather than inside the workspace bucket — this isn't a "new session
 * in this folder" intent (that's the bucket's own "+"). Attaching a worktree
 * from the draft header still moves the row into that worktree's bucket.
 *
 * Same single-slot rule as the rest of New Session: an existing draft is
 * navigated to, not replaced. Unlike `startInCwd`'s retarget branch this
 * doesn't disown the draft's model/group/handoff state, because it isn't
 * retargeting anything — there's no new folder being asserted, so the draft
 * is left exactly as the user left it.
 */
export async function startNewSessionDraft(
	navigate: NavigateFunction,
	{ targetCwd, onWorkspaceRevealed }: StartOptions,
): Promise<void> {
	const drafts = useDraftSessionsStore.getState();
	if (drafts.draft) {
		navigate(`/sessions/${drafts.draft.id}`);
		return;
	}
	const cwd = await resolveDraftCwd(targetCwd);
	if (!cwd) return;
	const order = useSessionsStore.getState().order;
	const d = drafts.createDraft({
		cwd,
		defaultTitle: `Session ${order.length + 1}`,
		floating: true,
	});
	onWorkspaceRevealed?.(cwd);
	navigate(`/sessions/${d.id}`);
}

/**
 * One-click shortcut launch. A shortcut carries no cwd, so this reuses the
 * existing draft in place if there is one (same single-slot rule as the
 * rest of "New Session" — an existing draft is RETARGETED, not replaced),
 * otherwise resolves a folder (targetCwd, else the native picker) before
 * creating one. The prompt is appended to the composer rather than
 * overwriting it, and the composer textarea autofocuses on navigation
 * (`MessageComposer`'s sessionId-keyed focus effect).
 */
export async function startSessionFromShortcut(
	sc: Shortcut,
	navigate: NavigateFunction,
	{ targetCwd, onWorkspaceRevealed }: StartOptions,
): Promise<void> {
	const drafts = useDraftSessionsStore.getState();
	const draft = drafts.draft;
	let id: string;
	let cwd: string;
	if (draft) {
		// A shortcut launch is a fresh intent for the shared draft slot —
		// reset the model override to the app default rather than to nothing.
		drafts.updateDraft({
			mode: sc.mode,
			title: sc.title,
			model: appDefaultModel(),
		});
		id = draft.id;
		cwd = draft.cwd;
	} else {
		const resolved = await resolveDraftCwd(targetCwd);
		if (!resolved) return;
		const order = useSessionsStore.getState().order;
		const d = drafts.createDraft({
			cwd: resolved,
			defaultTitle: `Session ${order.length + 1}`,
			mode: sc.mode,
		});
		// createDraft always starts untitled; the shortcut title is an
		// updateDraft patch.
		drafts.updateDraft({ title: sc.title });
		id = d.id;
		cwd = resolved;
	}
	appendPromptBlock(id, sc.prompt);
	onWorkspaceRevealed?.(cwd);
	navigate(`/sessions/${id}`);
}

/**
 * One-click skill launch — same draft-slot rules as
 * `startSessionFromShortcut`, but a skill carries no mode or title: an
 * existing draft keeps both, a fresh draft gets the store defaults. The
 * skill's slash command is what gets appended to the composer.
 */
export async function startSessionFromSkill(
	skill: Skill,
	navigate: NavigateFunction,
	{ targetCwd, onWorkspaceRevealed }: StartOptions,
): Promise<void> {
	const drafts = useDraftSessionsStore.getState();
	const draft = drafts.draft;
	let id: string;
	let cwd: string;
	if (draft) {
		// Same disowning rule as startSessionFromShortcut — a skill launch is
		// a fresh intent for the shared draft slot.
		drafts.updateDraft({
			model: appDefaultModel(),
		});
		id = draft.id;
		cwd = draft.cwd;
	} else {
		const resolved = await resolveDraftCwd(targetCwd);
		if (!resolved) return;
		const order = useSessionsStore.getState().order;
		const d = drafts.createDraft({
			cwd: resolved,
			defaultTitle: `Session ${order.length + 1}`,
		});
		id = d.id;
		cwd = resolved;
	}
	appendPromptBlock(id, `/${skill.name}`);
	onWorkspaceRevealed?.(cwd);
	navigate(`/sessions/${id}`);
}
