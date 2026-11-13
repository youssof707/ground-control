# Keyboard shortcuts

Source of truth for app shortcuts. Update when one is added, changed, or removed.

- `Cmd+N` — new session in the last-used workspace
- `Cmd+S` — open a side quest
- `Cmd+K` — open the shortcut menu
- `Cmd+R` — quote selection into the composer
- `Ctrl+C` — interrupt the running turn (side quest if focused there, else active session; denies a pending permission prompt)
- `Cmd+P` — toggle plan ⇄ auto-edit (composer focused)
- `Enter` — send when idle; mid-turn, queue. Enter again on an empty composer sends a single queued message (queued <30s ago) immediately
- `Cmd+D` — start/stop dictation
- `Cmd+Shift+B` — Babysitter modal for the active session
- `Cmd+Enter` — save in the Babysitter modal
- `Cmd+Shift+S` — Scheduler modal
- `Cmd+M` — model picker (if the composer has text, the pick applies to the next message; while Claude is asking a question or waiting on plan approval, it applies once you respond)
- Letter keys in the model picker — pick the model with that badge letter
- `Cmd+Shift+T` — restore the last deleted / handed-off session
- `Cmd+Shift+H` — hand off the active session using its last assistant message
- `Cmd+Delete` — delete the active session (not while a text field is focused)
