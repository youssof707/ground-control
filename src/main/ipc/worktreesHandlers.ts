import { ipcMain } from "electron";
import * as fs from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import * as worktreesStore from "../core/store/worktrees";
import {
	isGitRepo,
	listLocalBranches,
	worktreeAdd,
	worktreeRemove,
} from "../sessions/worktrees";
import { getCurrentBranch } from "../sessions/git";
import { broadcast } from "../windows";
import type { CreateWorktreeInput } from "../../shared/schemas/worktrees";

/**
 * Filesystem-safe slug of a user-supplied display name. The leaf of the
 * worktree path shows up as the "repo name" in tools like VS Code's Source
 * Control panel, so we want it to look like what the user typed rather than
 * an opaque ULID. Lowercased, non-alphanumeric → `-`, collapse runs, trim.
 * Falls back to `"worktree"` for pathological inputs (all-punctuation, empty).
 */
function slugify(name: string): string {
	const s = name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return s || "worktree";
}

/**
 * Pick a unique absolute path under `root` derived from `displayName`.
 * Slug collisions (two worktrees named "Sandbox" from different repos, or
 * a stale on-disk dir from a previous run) get a numeric suffix: `sandbox`,
 * `sandbox-2`, `sandbox-3`, … Checks both the registry and the filesystem
 * so we don't collide with a directory git created but the registry forgot
 * about (crash between `worktreeAdd` and `worktreesStore.create`).
 *
 * Not concurrency-safe: two simultaneous creates could pick the same path.
 * The renderer only fires one at a time, so this is a documented-but-
 * accepted race.
 */
async function pickWorktreePath(
	root: string,
	displayName: string,
): Promise<string> {
	const base = slugify(displayName);
	const takenByRegistry = new Set(
		worktreesStore.list().map((w) => w.worktreePath),
	);
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? base : `${base}-${n}`;
		const full = path.join(root, candidate);
		if (takenByRegistry.has(full)) continue;
		const onDisk = await fs.stat(full).then(
			() => true,
			() => false,
		);
		if (onDisk) continue;
		return full;
	}
}

/**
 * IPC surface for the app-owned worktree registry. Mirrors the
 * notesHandlers structure — one `register*Handlers()` per feature,
 * called from `registerSessionsHandlers` at boot.
 *
 * Every mutation broadcasts `state:changed` (skip-self) so other
 * windows re-hydrate their local `useWorktreesStore`.
 */
export function registerWorktreesHandlers(): void {
	ipcMain.handle("worktrees:list", () => worktreesStore.list());

	ipcMain.handle(
		"worktrees:listForBaseDir",
		(_e, payload: { baseDir: string }) =>
			worktreesStore.listForBaseDir(payload.baseDir),
	);

	ipcMain.handle(
		"worktrees:isGitRepo",
		(_e, payload: { baseDir: string }) => isGitRepo(payload.baseDir),
	);

	// Used by the AttachWorktreeModal to show "Branching off `<current>`"
	// context text alongside the create form.
	ipcMain.handle(
		"worktrees:baseBranch",
		(_e, payload: { baseDir: string }) => getCurrentBranch(payload.baseDir),
	);

	// Backing store for the modal's "Existing branch" mode. Returns local
	// branches paired with the worktree that currently owns each one (if
	// any) — the renderer disables rows whose branch is already checked
	// out, since `git worktree add <path> <branch>` will refuse those.
	ipcMain.handle(
		"worktrees:listBranches",
		(_e, payload: { baseDir: string }) => listLocalBranches(payload.baseDir),
	);

	ipcMain.handle(
		"worktrees:create",
		async (e, input: CreateWorktreeInput) => {
			const displayName = input.displayName.trim();
			if (!displayName) throw new Error("Display name is required");
			if (!(await isGitRepo(input.baseDir))) {
				throw new Error(
					`"${input.baseDir}" is not a git repository — worktrees require a git repo.`,
				);
			}

			// Discriminated by `mode`: "new-branch" runs `git worktree add -b`,
			// "existing-branch" runs the plain form. Trim + presence-check the
			// branch name here rather than at the schema layer so the error
			// message matches what the user typed / selected.
			let branchName: string;
			let branchArg: { mode: "new" | "existing"; name: string };
			if (input.mode === "new-branch") {
				branchName = input.newBranch.trim();
				if (!branchName) throw new Error("Branch name is required");
				branchArg = { mode: "new", name: branchName };
			} else {
				branchName = input.existingBranch.trim();
				if (!branchName) throw new Error("Please pick a branch");
				branchArg = { mode: "existing", name: branchName };
			}

			const id = ulid();
			const worktreePath = await pickWorktreePath(
				worktreesStore.worktreesRoot(),
				displayName,
			);

			// Run git first — if it fails, we bail before writing the
			// registry entry, so the store never displays a phantom entry
			// with no on-disk checkout.
			await worktreeAdd({
				baseDir: input.baseDir,
				worktreePath,
				branch: branchArg,
			});

			try {
				const wt = await worktreesStore.create({
					id,
					displayName,
					color: input.color,
					baseDir: input.baseDir,
					worktreePath,
					branch: branchName,
					createdAt: Date.now(),
					sessionIds: [],
				});
				broadcast("state:changed", undefined, e.sender.id);
				return wt;
			} catch (err) {
				// Registry write failed after git succeeded — try to clean up the
				// dangling checkout so we don't leave orphaned dirs under the
				// worktrees root. Best-effort: swallow both the returned error
				// list and any thrown exception, since we're already unwinding.
				await worktreeRemove({ baseDir: input.baseDir, worktreePath }).catch(
					() => undefined,
				);
				throw err;
			}
		},
	);

	ipcMain.handle("worktrees:delete", async (e, id: string) => {
		const wt = worktreesStore.get(id);
		if (!wt) return;

		// Session-reference guard, hoisted up-front. The equivalent throw
		// inside `worktreesStore.remove` (core/store/worktrees.ts) still
		// fires as a defensive backstop, but doing it here means we don't
		// touch git for a worktree we're about to reject anyway.
		if (wt.sessionIds.length > 0) {
			throw new Error(
				`Cannot delete worktree "${wt.displayName}" — ${wt.sessionIds.length} session(s) still reference it.`,
			);
		}

		// Git first. If cleanup fails, we KEEP the registry entry so the
		// user can retry from the UI — mirrors the "run git first, write
		// registry after" pattern in `worktrees:create` above.
		const result = await worktreeRemove({
			baseDir: wt.baseDir,
			worktreePath: wt.worktreePath,
		});

		if (!result.ok) {
			const detail = result.errors
				.map((x) => `  ${x.step}: ${x.message}`)
				.join("\n");
			throw new Error(
				`Worktree deletion partially failed — "${wt.worktreePath}" still exists on disk.\n${detail}`,
			);
		}

		// On-disk cleanup succeeded — now release the registry entry.
		await worktreesStore.remove(id);
		broadcast("state:changed", undefined, e.sender.id);
	});
}
