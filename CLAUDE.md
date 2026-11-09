# ground-control

Living rules for Claude working in this repo. Prefer patterns here over inventing new
ones. When a rule or convention changes — or a new durable one gets established — edit
this file so the next session inherits it.

## Landing page (`site/`)

`site/` is a separate Vite + React package for the marketing page. It is the only place
Tailwind is allowed; the app itself stays plain CSS. Its deps live in `site/node_modules`,
never at the root. Run it with `npm run landing` / `landing:build` / `landing:typecheck`
from the repo root. Feature showcases are hand-built DOM mocks in `site/src/mocks/` on a fixed
pixel canvas (`MockCanvas`) scaled by container query, never screenshots. Colors come from
the `gc-*` theme in `site/src/styles.css`, which mirrors `src/renderer/src/design/tokens.ts`;
keep them in sync. The same zero-comments and no-tooltip rules apply.

## Keyboard shortcuts

**Whenever a keyboard shortcut is added, changed, or removed, update this list.** This is
the single source of truth so shortcuts are easy to find.

- `Cmd+N` — new session in the last-used workspace, with no worktree or group
  (same as the sidebar's New Session button)
- `Cmd+S` — open a side quest
- `Cmd+K` — open the shortcut menu
- `Cmd+R` — quote the current selection into the composer and focus it
- `Ctrl+C` — interrupt the running turn, like a terminal. Stops the side quest
  when focus is inside the side quest panel, otherwise the active session —
  including one parked on a permission prompt (the prompt is denied). Works
  from anywhere, including inside a composer. A no-op (key passes through)
  when that target has no running turn, on a draft, or off a session route.
  Replaced the old `Cmd+.`
- `Cmd+P` — toggle plan ⇄ auto-edit, only while a session composer is focused
- `Enter` in a composer (main or side quest) — sends when the session is idle.
  While its turn is running, Enter queues the message instead (it shows as a
  chip above the composer and fires once the turn fully finishes). Pressing
  Enter again mid-turn sends that queued message immediately, but only when
  the composer is empty (no text or images), exactly one message is queued,
  and it was queued within the last 30 seconds; otherwise Enter behaves as
  above. Besides that, the only way to send mid-turn is a mouse click on the
  Send button; keyboard activation of that button queues too
- `Cmd+D` — start/stop voice dictation. Works from anywhere while a session
  is open: starts in whichever composer has focus (main or side quest),
  stops whichever take is already running regardless of focus, and is a
  no-op in any other text field (rename box, Babysitter text box) or with no
  session open
- `Cmd+Shift+B` — open the Babysitter modal for the active session, where
  Ground Control's auto-answers for that session's plan / permission /
  question prompts, keep-awake, and auto-resume after a usage limit are
  configured. No-op off a session route and on a draft session
- `Cmd+Enter` — inside the Babysitter modal, start/save (same as the primary
  button), even while typing in its text box. Plain `Enter` does the same
  when no text field has focus (a focused Cancel / Stop button keeps its
  native Enter). No-op when the primary button is disabled
- `Cmd+Shift+S` — open the Scheduler modal (the list of schedules). Works
  from anywhere
- `Cmd+Shift+M` — open the model picker for the active session or draft, or
  for the side quest when focus is inside the side quest panel (picking a
  model while a turn is running interrupts it, switches, and resumes
  automatically — in side quests too). The modal closes instantly and the
  switch runs in the background, with animated dots on the model label until
  it lands. If that composer has text (or images) in it, nothing is
  interrupted or switched: the pick is held for the next message (label
  shows `· next message`) and applied right before that message is sent, or
  attached to it if it gets queued — so each queued message can carry its
  own model, switched as it fires
- Letter keys inside the model picker — pick the model whose badge shows that
  letter. Each row gets the first letter of its name not already taken by an
  earlier row; rows with no free letter get no key
- `Cmd+Shift+T` — restore the most recently deleted / handed-off
  session, from anywhere (including inside a composer). No-op when nothing
  is buffered
- `Cmd+Shift+H` — hand off the active session right now using its last
  assistant message with text, exactly like that message's ⋯ Handoff item.
  Works mid-turn (the running turn is killed with the old session) and from
  anywhere, including inside a composer. Unlike `/handoff`, it never asks
  Claude to write a brief or waits for the turn to end. No-op off a session
  route, on a draft, while a modal is open, or when there is no assistant
  text yet
- `Cmd+Delete` (Cmd+Backspace) — delete the active session, exactly like its
  row's Delete item: if it's the last session on a worktree, the same
  delete-worktree confirm modal opens instead of deleting outright. No-op off
  a session route, on a draft, while any text field (including a composer)
  has focus so native delete-to-line-start keeps working, and while another
  modal is open

## Schedules

Each schedule owns exactly one session. Every run deletes the schedule's previous
session (`ScheduleRunner.prune`), and there is no option to keep past runs. Replying
to a scheduled session never detaches it from its schedule.

Every scheduled session gets an in-process MCP tool, `mcp__ground-control__report`
(`src/main/sessions/scheduleReportTool.ts`), pre-allowed so the Babysitter never sees it,
plus a system-prompt append telling Claude to call it once when done with
`{ color: green|yellow|red, line, alert? }`. The latest call becomes `schedule.status`;
`alert` is a separate message to the user (not a copy of `line`) and also sets
`schedule.alert`. A run that ends without calling it settles as
green `nothing to report`; one that errors or hits a usage limit settles as yellow
`run failed` (`src/main/sessions/scheduleStatus.ts`). The sidebar `SchedulerWidget`
shows one row per enabled schedule with a status, except that a schedule whose
per-schedule "Always show status" toggle (`schedule.alwaysShowStatus`, off by default, set
in the schedule form) is off only gets a row while its status is not green; the collapsed
header summary covers only those visible rows. It pins alerts at the top regardless, and clears an
alert when it is clicked (which also opens the session) or dismissed with its x.
Each alert also shows inside its schedule's card in the Scheduler modal, as a card in the Inbox, counts toward the Inbox badge and the dock
badge, and fires a macOS notification when raised. Clicking the notification opens the
session and clears the alert, same as clicking it in the widget or Inbox.

## Code rules

**ZERO COMMENTS. EVER. No exceptions.** Code must explain itself.

- No doc blocks, no inline comments, no JSX comments, no "why" comments, no TODOs.
- If something needs a comment to be understood, the code is wrong: rename it, split it,
  or restructure it until the comment is unnecessary.
- The only tolerated exception is a single one-line comment where leaving it out would be
  life-or-death (a non-obvious bug that *will* be reintroduced otherwise). Treat that as
  almost never.
- Do not add comments to code you touch, and do not leave your own comments behind.

## Privileged helpers

The only `sudo` in the app is `pmset schedule wake` / `pmset schedule cancel wake`, run
by `src/main/sessions/wakeScheduler.ts` through a one-time `/etc/sudoers.d/ground-control`
rule it installs via a single macOS admin prompt. Never widen that rule or add other
privileged commands. Always `execFile` with absolute binary paths and `sudo -n`, never a
shell.

## Verification rules

**NEVER use Playwright. Ever.** No `playwright`, no `playwright-core`, no
`_electron.launch`, no driver scripts that wrap it. Don't install it, don't script it,
don't suggest it.

**Never run the app unless I explicitly ask in that request.** By default: no
`npm run dev`, no `npm start`, no launching Electron, no driving it with a script. Don't
web-scrape, don't spin up browsers, don't invent manual click-through scripts and execute
them, don't `git stash` to diff behavior. I run the app and verify behavior myself — make
the change and hand it to me.

**When I do ask you to run / E2E test the app, it must be completely invisible to me.**
I'm working on the same machine. I must not see it, hear it, or be interrupted by it.

- Launch in the background so it never takes focus: `open -g` style, never activate it.
  Pass `--remote-debugging-port=<port>` (renderer) and `--inspect=<port>` (main process).
- Right away, through the main-process inspector, run `app.dock.hide()` and move every
  `BrowserWindow` to about `-10000,-10000` with `setPosition`. Call
  `webContents.setBackgroundThrottling(false)` on each. Apply the same to any window
  opened later.
- Keep windows "shown" off-screen rather than calling `hide()` or `show: false`. Hidden
  windows can stop painting, which gives blank screenshots and stalled animations.
- Drive it only through CDP: `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent` for
  input, `Runtime.evaluate` for DOM state, `Page.captureScreenshot` for screenshots. Never
  touch the real keyboard, mouse, clipboard, or screen (no AppleScript, no `cliclick`, no
  `screencapture`).
- No sound: don't trigger dictation, system beeps, or notifications. Mute anything that
  could make noise.
- Use a throwaway `--user-data-dir` so my real sessions and settings are untouched, and
  never collide with a copy of Ground Control I already have running.
- Put CDP client deps (`ws`, `chrome-remote-interface`) in a temp dir, never in the repo.
- Never move, rename, copy, back up, or write into the repo's `.dev-store/`. A dev
  build stores data in `<cwd>/.dev-store`, so for a clean store launch Electron with
  its working directory set to a temp dir outside the repo.
- Never create files or folders anywhere inside the repo during a test run. All
  scratch files, screenshots, backups, and stores go in a temp dir outside it.
- When done, kill every process you started and leave `git status` exactly as you
  found it. Check `git status` before handing back; any new untracked or modified
  path you caused gets removed.
- Never ask me to look at, focus, enable, or click anything. Playwright is still banned.

**Static checks are fine — run them, don't ask.** `npm run typecheck`, `npm run lint`,
and builds are expected after any non-trivial change. They don't launch anything, and
handing over code that doesn't compile wastes my time. Fix what they report.

## UI rules

**NO TOOLTIPS. EVER. Unless I explicitly ask for one in that specific request.**

- Never add a `title=` attribute to an element. macOS renders it as a hover bubble.
- Never add a hover-reveal label, popover label, or `group-hover:` text bubble.
- Never install or reach for a tooltip library (Radix, shadcn, react-tooltip, tippy,
  floating-ui). This repo has none — keep it that way.
- Do not add tooltips "for accessibility" or "for discoverability." If a control needs
  explanation, the answer is a better icon, a visible label, or nothing — not a tooltip.
- `title` as a *prop* on `ConfirmModal` / `Section` / `InlineOption` is a visible heading.
  That's fine and unrelated.
