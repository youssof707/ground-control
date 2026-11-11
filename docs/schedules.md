# Schedules

Each schedule owns exactly one session. Every run deletes the schedule's previous
session (`ScheduleRunner.prune`), and there is no option to keep past runs. Replying
to a scheduled session never detaches it from its schedule.

Every scheduled session gets an in-process MCP tool, `mcp__ground-control__report`
(`src/main/sessions/scheduleReportTool.ts`), pre-allowed so the Babysitter never sees it,
plus a system-prompt append telling Claude to call it once when done with
`{ color: green|yellow|red, line, alert? }`. The latest call becomes `schedule.status`;
`alert` is a separate message to the user (not a copy of `line`) and also sets
`schedule.alert`. A run that ends without calling it settles as green `nothing to report`;
one that errors or hits a usage limit settles as yellow `run failed`
(`src/main/sessions/scheduleStatus.ts`).

The sidebar `SchedulerWidget` shows a row for a schedule with a status (enabled or not) only when
`schedule.alwaysShowStatus` is on (always shown, any color) or its session is unread (any
color, including green). The schedule whose session is open always has a row (even with no
status yet), so opening it from the widget (which marks it read) never makes the row vanish;
once you navigate away it falls back to the normal rule, so a read always-show-off row hides.
A schedule with a running session always has a row, and its status dot becomes a spinner
while it runs. The widget is always expanded (it has no collapse). Alerts pin
at the top regardless and clear when clicked (which opens the session) or dismissed.
Each alert also shows in its schedule's card in the Scheduler modal and as an Inbox card,
counts toward the Inbox and dock badges, and fires a macOS notification. Clicking the
notification opens the session and clears the alert.

A scheduled session's header replaces the worktree row with `ScheduleHeaderStrip`:
cadence, next run (omitted when off or none), last run, skip reason or error, plus labeled Always show
and On switches, Run now / Stop, and Edit, which opens the Scheduler directly on that
schedule's form (Save or Cancel closes it). Delete and Clear status stay in the modal.
Controls shared with the modal card live in `hooks/useScheduleControls.ts`. Run now
switches to the new session when you were viewing the schedule's previous one.

A schedule card's ⋯ menu has Clear status (shown only while it has a status or alert),
which resets `schedule.status` and `schedule.alert`. While the session is running (or
parked on a permission prompt), Run now becomes Stop, which interrupts the run
(`SessionManager.stopScheduledRun`) and, unless Claude already reported, settles it as
yellow `stopped`.
