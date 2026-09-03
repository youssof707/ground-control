import { z } from "zod";

/**
 * App-owned git worktree. The user picks a base repo (baseDir); the app
 * creates a new branch there and checks it out into `worktreePath`, which
 * lives inside the app's userData dir so it's invisible to normal browsing.
 * Sessions attach to a worktree at draft time (immutable post-creation)
 * and their SDK query then runs inside `worktreePath` — while everything
 * the UI displays about the "folder" (folder button label, copy path,
 * reveal in Finder) continues to reference `baseDir`.
 *
 * `displayName` is a cosmetic label chosen by the user, distinct from the
 * branch name. It's the only thing shown on the badge.
 *
 * `color` is the badge's tint. Chosen at creation, immutable, same
 * lifecycle as `displayName`. Scoped to a small palette that maps to
 * existing design tokens (info/danger/neutral). "gray" is the neutral
 * entry — its `fg` is `T.textMute`, the exact color of a cwd/worktree
 * bucket's header label, so a session group can be made to match an
 * ungrouped folder section exactly instead of only approximating it.
 *
 * Two schemas, deliberately: `WorktreeColorSchema` is the *selectable*
 * palette (what the picker offers, what creation inputs accept), while
 * `StoredWorktreeColorSchema` is the *read* schema for persisted records.
 * The palette used to include "green" and "yellow"; the stored schema
 * folds those onto "blue"/"red" on read, so `worktrees.json` files
 * written by older builds keep parsing and get rewritten in the new
 * vocabulary on the next persist. It's also total — a missing field or a
 * hand-edited garbage value degrades to "blue" instead of throwing at
 * store init, which would take app startup down.
 *
 * `sessionIds` is the reverse index: which sessions currently reference
 * this worktree. Used to enforce "no delete while attached" and to
 * cascade-detach on session delete.
 */
export const WorktreeColorSchema = z.enum(["blue", "red", "gray"]);
export type WorktreeColor = z.infer<typeof WorktreeColorSchema>;

/**
 * Legacy palette → current palette. Keyed loosely (`string`) so retired
 * values and unknown junk both flow through the same lookup; the `??`
 * is the catch-all. Values map by semantics: green was "ok" (→ blue,
 * the neutral/info tint), yellow was "warn" (→ red, the alert tint).
 * Live palette members (blue/red/gray) map to themselves — without an
 * identity entry here, `normalizeWorktreeColor` would silently fold a
 * persisted "gray" back to "blue" on every read.
 */
const LEGACY_COLOR_ALIASES: Record<string, WorktreeColor | undefined> = {
	blue: "blue",
	red: "red",
	gray: "gray",
	green: "blue",
	yellow: "red",
};

export function normalizeWorktreeColor(value: unknown): WorktreeColor {
	return (
		(typeof value === "string" ? LEGACY_COLOR_ALIASES[value] : undefined) ??
		"blue"
	);
}

/**
 * Read schema for the persisted `color` field. Never throws: normalizes
 * first, then validates against the live palette so a normalizer bug
 * still surfaces as a parse error.
 */
export const StoredWorktreeColorSchema = z.preprocess(
	normalizeWorktreeColor,
	WorktreeColorSchema,
);

export const WorktreeSchema = z.object({
	id: z.string(),
	displayName: z.string(),
	color: StoredWorktreeColorSchema,
	baseDir: z.string(),
	worktreePath: z.string(),
	branch: z.string(),
	createdAt: z.number(),
	sessionIds: z.array(z.string()).default([]),
});
export type Worktree = z.infer<typeof WorktreeSchema>;

export const WorktreesFileSchema = z.object({
	items: z.record(z.string(), WorktreeSchema),
});
export type WorktreesFile = z.infer<typeof WorktreesFileSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Two creation paths, discriminated by `mode`:
 *
 *   - "new-branch": app runs `git worktree add -b <newBranch> <path>` and
 *     the branch is created off the base repo's current HEAD.
 *
 *   - "existing-branch": app runs `git worktree add <path> <existingBranch>`
 *     and checks out a branch that already exists in the base repo. Git
 *     will refuse if the branch is already checked out in another worktree
 *     (including the base repo itself) — the modal pre-filters via
 *     `listBranches` so the user sees which are eligible.
 *
 * `displayName` is the cosmetic label for the chip and is required in both
 * modes.
 */
const CreateWorktreeNewBranchInputSchema = z.object({
	mode: z.literal("new-branch"),
	baseDir: z.string(),
	displayName: z.string(),
	color: WorktreeColorSchema,
	newBranch: z.string(),
});
const CreateWorktreeExistingBranchInputSchema = z.object({
	mode: z.literal("existing-branch"),
	baseDir: z.string(),
	displayName: z.string(),
	color: WorktreeColorSchema,
	existingBranch: z.string(),
});
export const CreateWorktreeInputSchema = z.discriminatedUnion("mode", [
	CreateWorktreeNewBranchInputSchema,
	CreateWorktreeExistingBranchInputSchema,
]);
export type CreateWorktreeInput = z.infer<typeof CreateWorktreeInputSchema>;

/**
 * One row returned by `worktrees:listBranches`. `worktreePath` is
 * `null` when the branch is free (not checked out anywhere); non-null
 * when git has it pinned to another worktree — either the base repo
 * itself or a sibling app-owned checkout. The renderer disables those
 * rows so the user can't hit git's "already used" error.
 */
export const LocalBranchSchema = z.object({
	name: z.string(),
	worktreePath: z.string().nullable(),
});
export type LocalBranch = z.infer<typeof LocalBranchSchema>;
