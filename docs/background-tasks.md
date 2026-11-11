# Background tasks

The "N background tasks" chip and sidebar pill list two kinds of work per session:

- Tasks the Claude CLI reports itself (`run_in_background` shells, subagents, workflows).
- Detached processes: anything Claude started that escaped the CLI, e.g. `(npm run dev &)`
  or `nohup`. These show as `detached`, with their listening ports.

Every session's CLI is spawned with `GROUND_CONTROL_SESSION_ID=<session id>` in its
environment, and every process it starts inherits it, even after reparenting to launchd.
`src/main/sessions/detachedProcesses.ts` scans `ps -E` every 3s and after each tool result.
A tagged process is listed when its parent is not tagged with the same id and is not
Ground Control itself, so processes still under the CLI are not double-counted and
processes you start yourself are never listed.

Stop sends SIGTERM to the process and its tagged descendants, then SIGKILL after 3s.
Deleting or handing off a session stops its detached processes too.

Limits: macOS hides the environment of Apple platform binaries, and `env -i` drops the tag.
