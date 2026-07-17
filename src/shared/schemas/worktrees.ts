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
 * existing design tokens (info/ok/warn/danger). Defaults to "blue" so
 * pre-existing rows in `worktrees.json` (written before this field
 * existed) get backfilled by Zod on read.
 *
 * `sessionIds` is the reverse index: which sessions currently reference
 * this worktree. Used to enforce "no delete while attached" and to
 * cascade-detach on session delete.
 */
export const WorktreeColorSchema = z.enum(["blue", "green", "yellow", "red"]);
export type WorktreeColor = z.infer<typeof WorktreeColorSchema>;

export const WorktreeSchema = z.object({
	id: z.string(),
	displayName: z.string(),
	color: WorktreeColorSchema.default("blue"),
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
