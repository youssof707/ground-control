import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import os from "node:os";
import path from "node:path";

/**
 * Single source of truth for where the on-disk store lives.
 *
 * Dev builds use a repo-local `.dev-store/` so dev data is isolated from any
 * installed prod build's userData. Prod builds use the Electron userData dir.
 */
export function resolveDataDir(): string {
	return is.dev
		? path.join(process.cwd(), ".dev-store")
		: path.join(app.getPath("userData"), "data");
}

/**
 * Root directory for git worktree *checkouts* (not the metadata registry).
 * Kept separate from `resolveDataDir()` because worktree paths get passed
 * into user-authored git hooks, where spaces in the path break unquoted
 * `$GIT_DIR` / `$PWD` expansions. `app.getPath("userData")` contains
 * "Application Support" on macOS, and `process.cwd()` in dev inherits any
 * space in the repo's parent path — so we route around both via the home
 * dir, which is space-free on macOS/Linux for typical usernames.
 *
 * Dev/prod isolation mirrors the `.dev-store` split: dev worktrees live
 * under `~/.ground-control-dev/`, prod under `~/.ground-control/`.
 */
export function resolveWorktreesRoot(): string {
	const leaf = is.dev ? ".ground-control-dev" : ".ground-control";
	return path.join(os.homedir(), leaf, "worktrees");
}
