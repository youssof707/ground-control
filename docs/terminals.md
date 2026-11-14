# Terminals

The Terminals card sits at the bottom of the sidebar, above the version line. It runs
real login shells inside Ground Control so dev servers do not need a separate terminal
window.

- **Add Terminal** spawns `$SHELL -l` and opens it in a modal. The working directory is
  the open session's worktree path, or its `cwd` when it has no worktree. With no session
  open it is `lastUsedWorkspace`. A missing directory falls back to the home directory.
- Closing the modal (Escape, close button or backdrop click) leaves the shell running.
  Escape never reaches the shell. Ctrl+C goes to the shell while the modal is open and
  does not stop the session.
- Each row is a group of 1 to 4 terminals. **Split** in the modal adds a terminal to the
  group in the group's directory, up to 4. Panes lay out in a grid: 2 side by side, the 3rd
  splits the left pane top/bottom, the 4th splits the right one. The new pane takes focus,
  and Split always splits the focused pane's group.
- Every pane has an always-visible floating card in its top-right corner: the terminal's
  status dot, Start / Stop (see below) for just that terminal, and a `×` that deletes just
  that pane (second click needed while alive). Typing `exit` in a pane removes it too. Delete in the header and the
  row `×` delete the whole group.
- A row shows the group's dot, name, terminal count (when more than 1), and the most
  recent output line from any of its terminals. The dot is red if any terminal crashed,
  else green if any is running, else gray. Clicking the row reopens the modal with each
  pane's scrollback (last 256k characters).
- The name belongs to the group and defaults to the folder name. Click it in the modal
  header to rename (Enter or blur saves, Escape cancels, an empty name restores the folder
  name). Names survive a restart (see below).
- **Save Config** in the modal header asks for a config name (prefilled with the group
  name), then saves the group's directory and the last command entered in each terminal
  (in pane order). Saving again with the same name and directory overwrites it. Configs persist in `terminal_configs.json` in
  the data dir.
- **Load Config** lists only the saved configs whose directory matches the directory the
  open group was spawned in, each as its name plus its terminal count. Picking one kills every terminal in the open
  group, without confirmation, and replaces them with the config's terminals, each running its command
  once its shell has started (output quiet for 300ms, or 5s at most). Terminals saved
  without a command start idle. The hover `×` on a config deletes it (second click).
- The last command is read from a headless xterm screen (`@xterm/headless`) the moment
  Enter is pressed at the shell prompt, so edits and history recall are captured as
  shown. Input sent while a foreground command is running is not recorded.
- The latest output line skips the shell prompt. The prompt is learned from the
  unfinished line on screen at the first keystroke after each Enter, and completed lines
  starting with it (the echoed command) are ignored. An unfinished line (e.g. a progress
  bar) only counts while a foreground command is running. Multi-line prompts are not
  recognised: their upper lines show up as output.
- Gray dot: the shell is idle at its prompt. Green dot: a command is in the foreground
  (e.g. `npm run dev`). Red dot: the shell exited with a non-zero code. The main process
  checks the PTY's foreground process name once a second; anything other than the shell
  counts as running. A red row keeps its scrollback until it is removed. A clean exit
  (code 0) removes the row.
- The `×` on a row, or Delete in the modal, kills the group's shells and removes the row.
  If any shell is alive it needs a second click (`Delete?` / `Confirm delete`), which reverts after 3s
  or when the pointer leaves the row. Removing an all-crashed group is a single click.
- Hovering a row also shows **Stop** (square) while any terminal in the group is running,
  and **Start** (play) while any is idle at its prompt with a last command. Stop sends
  Ctrl+C to every running terminal in the group, with no confirmation. Start re-runs each
  idle terminal's last command (commands launched by Load Config count). Crashed terminals
  are skipped by both. Both hide while the `Delete?` confirm is showing.
- Quitting kills every shell, without a quit confirmation, but first writes each group's
  name, directory and per-terminal last command to `saved_terminals.json` in the data dir.
  On the next launch every saved group comes back as fresh idle shells in the same
  directory (home if it no longer exists), with the same name and pane count, and each
  terminal's last command remembered but not run. **Start** on the row revives them.
  Scrollback and crashed status are not kept. If the app quits before the restore has
  finished, the file is left untouched.

Code: `src/main/terminals/TerminalManager.ts` owns the PTYs (`node-pty`) and broadcasts
`terminals:data` and `terminals:changed`. `src/main/ipc/terminalsHandlers.ts` exposes
them. The renderer side is `TerminalsCard.tsx`, `TerminalModal.tsx` (`@xterm/xterm`) and
`useTerminalsStore.ts`. `scripts/fix-node-pty-helper.mjs` runs on postinstall because the
`node-pty` prebuilt `spawn-helper` ships without its executable bit.
