# Schedules

The UI calls these "Tasks" (sidebar widget, modal, shortcut label). Code, IPC and storage keep the `schedule` name.

A schedule's `kind` is one of: `once` (a single date and time), `repeat` (every N minutes
or hours), `daily` (one time every day), or `weekly` (one time on chosen weekdays, e.g. Mon,
Wed, Fri at 9:00; `days` uses `Date.getDay()` numbers, Sunday = 0). `nextFireAfter` in
`src/shared/schemas/schedules.ts` computes the next local-time run for each. The form's
Weekly option shows Mon to Sun toggles plus one time field (shared with Daily) and
requires at least one day. Cadence labels collapse all seven days to "Daily", Mon to Fri
to "Weekdays", and Sat + Sun to "Weekends".

Each schedule owns exactly one session. Every run deletes the schedule's previous
session (`ScheduleRunner.prune`), and there is no option to keep past runs. Replying
to a scheduled session never detaches it from its schedule.

Every scheduled session gets an in-process MCP tool, `mcp__ground-control__report`
(`src/main/sessions/scheduleReportTool.ts`), mounted on the same `ground-control` server as
the schedule tools below and pre-allowed so the Babysitter never sees it,
plus a system-prompt append telling Claude to call it once when done with
`{ color: green|yellow|red, line }`. The latest call becomes `schedule.status`. This
stoplight status is the only channel from a scheduled agent to Ground Control: there is
no alert, Inbox card, badge, or macOS notification for schedules. A run that ends
without calling it settles as green `nothing to report`;
one that errors or hits a usage limit settles as yellow `run failed`
(`src/main/sessions/scheduleStatus.ts`).

The sidebar `SchedulerWidget` shows a row for a schedule with a status (enabled or not) only when
`schedule.alwaysShowStatus` is on (always shown, any color) or its session is unread (any
color, including green). The schedule whose session is open always has a row (even with no
status yet), so opening it from the widget (which marks it read) never makes the row vanish;
once you navigate away it falls back to the normal rule, so a read always-show-off row hides.
A schedule with a running session always has a row, and its status dot becomes a spinner
while it runs. The widget is always expanded (it has no collapse).
Whenever a new status replaces a green one with yellow or red (a report or a settled run,
in `scheduleStatus.ts`), `alwaysShowStatus` is turned on automatically so the regression
stays visible; it is never turned off automatically.

A scheduled session's header replaces the worktree row with `ScheduleHeaderStrip`, which spans
the full header width; the Source Control widget sits below it, beside the title row.
The strip shows
cadence, next run (omitted when off or none), last run, skip reason or error, plus labeled Always show
and On switches, Run now / Stop, and Edit, which opens the Scheduler directly on that
schedule's form (Save or Cancel closes it). Delete and Clear status stay in the modal.
Controls shared with the modal card live in `hooks/useScheduleControls.ts`. Run now
switches to the new session when you were viewing the schedule's previous one.

A schedule card's ⋯ menu has Clear status (shown only while it has a status),
which resets `schedule.status`. While the session is running (or
parked on a permission prompt), Run now becomes Stop, which interrupts the run
(`SessionManager.stopScheduledRun`) and, unless Claude already reported, settles it as
yellow `stopped`.

## Claude tools

Every session, scheduled runs included, gets an in-process MCP server named `ground-control`
(`src/main/sessions/scheduleControlTool.ts`), with `list_schedules`, `create_schedule` and
`update_schedule`. Listing is pre-allowed. Create and update go through the usual permission
prompt. Claude can set a task's name, prompt, folder, model and timing (`once` local ISO time,
`repeat` minutes/hours, `daily` HH:MM, `weekly` weekday names + HH:MM). It cannot see or change
babysit settings, enabled, or Always show, and it cannot delete or run tasks. New tasks copy the
app's default babysit config, like the form does. The create and update tool descriptions tell
Claude to use them only when the user or the task's own prompt explicitly asks. The UI and
the tools share validation in `src/main/sessions/scheduleMutations.ts`.
