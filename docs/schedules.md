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

The sidebar `SchedulerWidget` shows one row per enabled schedule with a status, except a
schedule with `schedule.alwaysShowStatus` off (the default) only gets a row while its
status is not green; the collapsed header summary covers only visible rows. Alerts pin
at the top regardless and clear when clicked (which opens the session) or dismissed.
Each alert also shows in its schedule's card in the Scheduler modal and as an Inbox card,
counts toward the Inbox and dock badges, and fires a macOS notification. Clicking the
notification opens the session and clears the alert.

A schedule card's ⋯ menu has Clear status (shown only while it has a status or alert),
which resets `schedule.status` and `schedule.alert`. While the session is running (or
parked on a permission prompt), Run now becomes Stop, which interrupts the run
(`SessionManager.stopScheduledRun`) and, unless Claude already reported, settles it as
yellow `stopped`.
