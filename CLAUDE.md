# ground-control

Living rules for Claude working in this repo. Prefer patterns here over inventing new
ones. When a rule or convention changes — or a new durable one gets established — edit
this file so the next session inherits it.

## Keyboard shortcuts

**Whenever a keyboard shortcut is added, changed, or removed, update this list.** This is
the single source of truth so shortcuts are easy to find.

- `Cmd+N` — new session, pre-attached to the worktree last used in that
  workspace
- `Cmd+S` — open a side quest
- `Cmd+K` — open the shortcut menu
- `Cmd+R` — quote the current selection into the composer and focus it
- `Cmd+.` — stop/interrupt the active session's running turn
- `Cmd+P` — toggle plan ⇄ auto-edit, only while a session composer is focused
- `Cmd+D` — start/stop voice dictation. Works from anywhere while a session
  is open: starts in whichever composer has focus (main or side quest),
  stops whichever take is already running regardless of focus, and is a
  no-op in any other text field (rename box, notes editor) or with no
  session open
- `Cmd+Shift+M` — open the model picker for the active session (picking a
  model while a turn is running interrupts it, switches, and resumes
  automatically)
- `Cmd+Shift+Z` — restore the most recently deleted / handed-off / archived
  session. Ignored while a text field has focus (native redo wins) and when
  nothing is buffered. Not `Cmd+Z`: that's the most-used text shortcut in the
  app, and claiming it would mean hand-rebuilding the native Edit menu

## Verification rules

**NEVER use Playwright. Ever.** No `playwright`, no `playwright-core`, no
`_electron.launch`, no driver scripts that wrap it. Don't install it, don't script it,
don't suggest it.

**Never run the app.** No `npm run dev`, no `npm start`, no launching Electron, no
driving it with a script. Don't web-scrape, don't spin up browsers, don't invent manual
click-through scripts and execute them, don't `git stash` to diff behavior. I run the app
and verify behavior myself — make the change and hand it to me.

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
