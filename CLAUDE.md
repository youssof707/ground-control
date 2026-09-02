# ground-control

Living rules for Claude working in this repo. Prefer patterns here over inventing new
ones. When a rule or convention changes — or a new durable one gets established — edit
this file so the next session inherits it.

## Keyboard shortcuts

**Whenever a keyboard shortcut is added, changed, or removed, update this list.** This is
the single source of truth so shortcuts are easy to find.

- `Cmd+S` — open a side quest
- `Cmd+K` — open the shortcut menu
- `Cmd+Shift+M` — open the model picker for the active session (picking a
  model while a turn is running interrupts it, switches, and resumes
  automatically)

## Verification rules

**NEVER use Playwright. Ever.** No `playwright`, no `playwright-core`, no
`_electron.launch`, no driver scripts that wrap it. Don't install it, don't script it,
don't suggest it.

**Don't test it yourself. At all.** Don't run `npm run dev`, don't launch the app, don't
run typecheck/lint/build as a self-check, don't `git stash` to diff behavior, don't invent
manual click-through scripts and execute them. Make the change, then stop and hand it to
me — I run the app and verify it myself. If you genuinely need a command run to unblock
implementation (not to convince yourself the change works), ask first.

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
