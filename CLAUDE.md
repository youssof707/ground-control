# ground-control

Only add rules here that apply to every task. Feature behavior goes in `docs/`.

- **Zero comments.** No doc blocks, inline, JSX, or TODO comments. Make the code explain itself.
- **No tooltips.** No `title=` attributes, hover labels, or tooltip libraries. The `title` prop on `ConfirmModal` / `Section` / `InlineOption` is a visible heading and is fine.
- **Never use Playwright. Never run the app** unless asked in that request. If asked, follow `docs/e2e.md`.
- Run `npm run typecheck` and `npm run lint` after non-trivial changes and fix what they report.
- The only `sudo` is `pmset schedule wake` / `cancel wake` in `src/main/sessions/wakeScheduler.ts`. Never widen it. Always `execFile`, absolute paths, `sudo -n`.
- `site/` (landing page) is the only place Tailwind is allowed. Its deps stay in `site/node_modules`, and its `gc-*` colors mirror `src/renderer/src/design/tokens.ts`.
- Changing a shortcut: update `docs/shortcuts.md`. Working on schedules: read `docs/schedules.md`.
