# Source control

A repo card sits at the right end of every session header (and the draft header row). It replaces the old branch chip and change-count chip. It has two rows:

- **Branch row**: branch icon plus the checked-out branch, or `Detached at <sha>`. Clicking it opens the branch modal (sessions only). When the branch differs from the one at your last message, the text turns red and gets a red dot. Opening the branch modal clears the red for that session until the branch or baseline changes again (in memory only). The "Previously working on X" line and its **Switch back** button live in the branch modal, not the header.
  - Sync counts sit at the right end of this row, only when nonzero: `↓N` pulls (`git pull --ff-only`) and `↑N` pushes (`git push`). In sync shows nothing.
  - A branch with no upstream always shows `↑N`, where N is commits not on any `origin/*` ref (`git rev-list --count HEAD --not --remotes=origin`). Clicking it publishes with `git push -u origin HEAD`. With no `origin` remote, nothing shows.
  - While one runs, it shows a spinner and the other is disabled. On success the checkout rescans and the session's branch refreshes.
  - When a pull or push fails, a hidden Sonnet session tries to fix it before any error shows (`src/main/sourceControl/gitAutoFix.ts`). The card says "Pull failed, Claude is fixing it…" meanwhile. The session runs in the checkout with the failed command and git's error, gets only Bash, Read, Edit, Write, Glob and Grep, and must call a `report` tool once with success and a one-line reason. It isn't saved to disk and doesn't appear in the inbox. A `PreToolUse` hook and `canUseTool` (`gitFixPolicy.ts`) block force pushes, remote deletes, `reset --hard`, `clean`, discarding checkouts/restores, `stash drop`, `branch -D`, global config and recursive `rm`. It stops after 40 turns or 5 minutes. Only when it reports failure (or never reports) does git's error show in the dismissable red box under the card, followed by Claude's reason. Background fetches and cancelled runs never trigger it.
- **Meta row**: file icon plus the change count ("12 changed" in amber, "2 conflicts" in red, "Clean" in grey). Then a folder icon plus the worktree name when the checkout is a linked worktree, otherwise the number of linked worktrees. Clicking it opens the source control modal. A path with both staged and unstaged changes counts once; untracked files are included.
- Counts come from `git status --branch` against the last fetched remote refs. The active checkout runs `git fetch --prune` in the background on session switch, on window focus (at most once a minute), and every 5 minutes while the app is focused. Then it rescans.
- Remote commands run with `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes`, so missing credentials fail fast instead of hanging. Pull and push share the worker's single write slot with stage / unstage / discard / switch; fetch uses a read slot.

The card is hidden when the folder isn't a git repo, the folder is missing, or git isn't installed. Before the first scan finishes the meta row reads "Checking…".

The meta row opens a near-full-screen modal. It has the changed-file list on the left and an inline Monaco diff on the right. A dropdown switches between the repo's checkouts.

Confirming a commit closes the source control modal right away. The commit runs in the background, with a spinner on the card's push button. If it fails, the modal reopens (unless another one is already open) and shows the error.

When `git commit` itself fails (a hook rejected it, a formatter rewrote files, a stale `index.lock`), the same hidden Sonnet session as pull/push tries to fix it before any error shows. The card says "Commit failed, Claude is fixing it…". It gets git's error and the commit message, fixes the cause and stages the fixes, but may not commit itself, skip hooks, or change `core.hooksPath` / `commit.gpgsign`. When it reports success, the app runs `git commit` again with the same message. Only when it reports failure, or the retry fails, does the error show, followed by Claude's reason. Failures before `git commit` (nothing staged, message generation) never trigger it.

Sending the first message of a draft waits for its worktree to finish being created, then for any pull, push or commit (including Claude's fix and the retry) still running on the draft's checkout. Ops on other worktrees, other repos, and background fetches don't block it.

## The file list

- Two groups, like VS Code: **Staged Changes** (HEAD vs index) on top, then **Changes** (index vs working tree, plus untracked files and conflicts). A path with both kinds appears in both groups.
- File names are plain text with no status letters or colors. Deleted files are struck through.
- Selection: click selects one row, Cmd-click toggles a row, Shift-click and Shift+arrows select a range from the anchor, Cmd+A selects every row.
- Actions live only in a right-click menu; rows have no buttons. Right-clicking a row selects it unless it is already part of the selection, then offers Stage (if any picked row is unstaged), Unstage (if any is staged) and Discard Changes for the whole selection. Right-clicking a group header offers Stage All or Unstage All, and Discard All Changes. The context-menu key or Shift+F10 opens the menu for the focused row.
- Each row has an eye toggle at its right edge (shown on hover; a green check once viewed) that dims the row. Viewed state is kept in memory per checkout (staged and unstaged entries of a file are tracked separately), survives closing the modal, and is lost on reload.
- The **Changes** header has a **Stage All** button that stages the whole group at once (same as the header's Stage All menu item, no confirm). It is disabled while another action runs. When nothing is staged, **Commit All** sits next to it.
- Discard always asks once, then reverts everything picked with no exceptions:
  - staged rows and conflicts go back to HEAD in both index and working tree, and files that only exist in the index are deleted;
  - unstaged rows go back to the index;
  - untracked files are deleted permanently, not moved to the trash.
  - Untracked nested repositories (folders listed as `name/`) are never deleted, so a linked worktree inside the repo is safe.
- Acting on a whole group uses one repo-wide command (`git add -A`, `git reset`, `git reset --hard` + `git clean -fd`, `git restore --worktree .` + `git clean -fd`), so it covers rows past the 50,000 cap. Partial picks pass literal pathspecs on stdin (`--pathspec-from-file`), so non-UTF-8 and glob-like names work.
- Actions run one at a time in the worker, then trigger an urgent rescan. After it lands the focus stays on the same position in its group.

## Which checkout a session shows

The branch chip, the worktree name, the change count and the modal all use one checkout per session: `session.activeCheckout`. It is the git toplevel of the place Claude last worked, set in `SessionManager` (`src/main/sessions/workingCheckout.ts`):

- A successful `Edit`, `Write`, `MultiEdit` or `NotebookEdit` (main thread or subagent) points it at the worktree holding the edited file, even when the shell is elsewhere.
- A `CwdChanged` hook (a `cd`, `EnterWorktree`) points it at the new directory's worktree.
- A Bash command that writes into a worktree points it there (`src/main/sessions/bashWrites.ts`). The command is tokenized, `cd` targets are followed, and every path word is resolved. After the command (success or failure) a path counts as written when it or its parent folder has an mtime from after the command started. `cd X` and `git -C X` targets count when the worktree's `HEAD` or `logs/HEAD` changed (commit, checkout, reset). Reads change no mtimes, so they never move it. Writes to paths that never appear in the command (a script writing files) aren't detected.
- Whichever happened last wins. Directories outside any git repo are ignored.
- Sessions from before this existed are backfilled once from their transcript, using the per-entry `cwd` plus edit tool calls (not Bash).
- Without either signal it falls back to the session's worktree or cwd.

Changing it also resets `branch` and `lastUserMessageBranch` to that worktree's branch, so moving worktrees doesn't flag the chip red. The scan excludes linked worktrees nested inside the scanned checkout (for example `.claude/worktrees/*`), so the count only covers files in that one worktree.

## Branch chip and branch modal

- The branch row shows the branch from the latest scan. Only before the first scan does it fall back to the session's stored `branch`. When a scan's branch differs from the stored one, the card calls `refreshBranch` so the session record (sidebar chip, red stale state) catches up too.
- The worktree name in the card's meta row comes from git (the last part of `git rev-parse --git-dir`, e.g. `.git/worktrees/<name>`), not from the app's worktree registry, and arrives with each scan as `ScmSummary.worktreeName`. 
- Clicking the branch row opens the branch modal. The modal header shows the worktree and branch with a Copy button for the branch name. The inbox sidebar's chip still copies on click.
- The modal searches local and remote branches. Results: the current branch first, then local branches newest first, then remote branches that have no local branch of the same name. Every typed word must match; whole-word and prefix matches rank above fuzzy ones. At most 300 rows render, with the full match count in the footer.
- Enter or a click switches: `git switch --no-guess <name>` for local branches, `git switch --track <remote>/<name>` for remote ones. Git's own error (dirty tree conflicts, branch checked out in another worktree) shows in the modal. Branches checked out in another worktree carry that worktree's name. Switches share the worker's single write slot with stage / unstage / discard. On success the session's branch and the scan refresh.
- Branch lists (`git for-each-ref`, run in the worker) are cached in the renderer and persisted to `localStorage` (`gc.branches.v1`; 8 checkouts, first 2,000 branches each). The modal shows the cached list at once and refreshes in the background. Hovering the branch row prefetches when the cached list is older than 30 s.

## Rule: git never runs in the main process or the renderer

All git work runs in a dedicated `utilityProcess` (`src/main/sourceControl/scmWorker.ts`). The renderer talks to it over a direct `MessagePort`:

- On `scm:connect`, main creates the channel and sends one end to the worker and one to the window as `scm:port`. Main is not in the data path.
- If the worker dies, main broadcasts `scm:workerExit`. The client reconnects up to 3 times a minute, then shows Retry in the modal.

Protocol (`src/shared/schemas/source_control.ts`):

| Request | Reply |
|---|---|
| `scan` | Summary: counts, branch, upstream with ahead/behind, worktrees, `scanId`, `fingerprint`. Never the file list. |
| `rows` | One batch of at most 2,000 paths plus one status letter each, for a given `scanId`. |
| `diff` | Both sides of one row, or `binary` / `too-large` / `submodule` / `directory` / `gone` / `error`. |
| `apply` | Stage, unstage or discard. Each group is either `"all"` or a list of paths. |
| `remote` | `fetch`, `pull` or `push`; replies ok, or git's error message. |
| `watchHead` | Replies once the checkout's `HEAD` file changes. Stays open until then or until cancelled. |
| `cancel` | Kills the git process behind a request. |

## Scanning

- **Command:** `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=all --no-renames --ignore-submodules=dirty`.
- **Streaming:** output is streamed and split on NUL incrementally, never buffered whole.
- **Renames:** with `--no-renames`, renames show as delete plus add. Rename detection is the expensive part of status.
- **No timeout:** a cold scan of a huge repo can take a long time and prints nothing until it is done. Scans are bounded instead by:
  - one scan per checkout at a time, with at most one trailing rerun;
  - at most 2 scans in the worker at once;
  - killing scans for checkouts nobody is looking at.
- **Rows:** each status record becomes a staged row, an unstaged row, or both. Staged rows come first.
- **List cap:** the list stops at 50,000 rows. The counts stay exact and the sidebar says "Showing the first 50,000 of N".
- **Cache:** the worker keeps the last 3 scanned lists, so the modal opens from the scan that fed the widget.

## When it refreshes

The renderer's `RefreshScheduler` refreshes the active session's checkout on:

- session switch;
- new messages while the session is running;
- the session leaving `running`;
- window focus;
- an idle poll while the app is focused;
- opening the modal (urgent);
- the refresh button (urgent);
- the checkout's `HEAD` changing (see below).

Pacing:

- Non-urgent refreshes wait at least `max(2s, 2 × last scan time)` since the previous one.
- The idle poll runs every `max(15s, 10 × last scan time)`.
- There is no recursive file watcher; on huge repos it costs more than it saves.

`HEAD` watch: while a checkout is active, the renderer keeps one `watchHead` request open for it. The worker resolves the checkout's own git dir (`git rev-parse --git-dir`, so a linked worktree whose `.git` is a file watches `.git/worktrees/<name>`) and puts a non-recursive `fs.watch` on that directory. Only events for the `HEAD` file count. When one fires the request replies, the renderer requests a refresh (normal pacing) and re-arms. So a `git switch` / `checkout` from any terminal, in the app or outside it, updates the card within a scan. Switching sessions or a worker restart cancels and re-arms it (`src/main/sourceControl/headWatch.ts`).

## Diffs

- Staged rows diff the HEAD blob against the index blob.
- Unstaged rows diff the index blob against the file on disk, read without following symlinks. Conflicts use "ours" as the original side.
- Git runs at the repo top level (`git rev-parse --show-toplevel`), so a session folder inside a repo reads the right files.
- Binary content is detected from the first 8 KB.
- Size caps:
  - Files over 1 MB per side need "Load anyway".
  - Files over 8 MB are never loaded.
  - Files over 256 KB, or with a line over 10k characters, render as plain text.
- Holding an arrow key never queues work. The selection moves at once; the read is debounced by 80 ms and cancels the previous one.
- Monaco loads only when the modal first opens. It includes the core editor, diff, find, copy, and the lazy syntax-colouring definitions, but no language services.
- If Monaco's diff worker fails to start, diffs are disabled. Monaco would otherwise diff on the UI thread.

## Review comments

- When the modal was opened from a session or draft header, hovering a diff line shows a `+` in the gutter. Clicking it opens an inline comment box under that line; with a multi-line selection under the cursor, the comment covers the selected lines.
- Comments sit on lines of the new side only. Deleted lines can't be commented on directly.
- Enter saves, ⌘↵ (or ⇧↵) inserts a newline, Esc cancels. Saved comments can be edited or deleted in place.
- A file row with comments shows a grey comment icon left of the eye toggle (staged and unstaged entries are separate).
- Comments are kept in memory per checkout (keyed by file and staged/unstaged), survive closing the modal and switching files, and are lost on reload. Each stores a snapshot of its lines (up to 30), so the prompt stays unambiguous if the file changes later.
- **Send review (N)** in the modal header (or ⌘↵ while no comment box or text field is focused) appends one prompt to the session's composer (`path:start-end`, the fenced code, then the comment, sorted by path and line), clears the comments, closes the modal and focuses the composer. It doesn't send; the user edits and sends.

## Rendering

- The file list is windowed by hand: fixed 26 px rows, and only the visible rows plus overscan are mounted.
- Rows live in a plain buffer outside React state.
- When a rescan has the same `fingerprint`, the loaded list is reused. Otherwise the new list loads in the background and replaces the old one in one step. The focus and selection are then re-found by group and path.
- While the source control or branch modal is open, global hotkeys are ignored (`isSourceControlModalOpen`). Escape closes the modal unless Monaco's find widget is open.

## Benchmark

`npx vite-node scripts/scm-bench.ts --tracked 200000 --modified 20000 --untracked 30000 --big 4` builds a synthetic repo and prints scan time, worker event-loop stalls, message sizes, the time to diff a big file, and the time to cancel a scan and start a fresh one.
