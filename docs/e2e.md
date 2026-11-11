# Running the app for E2E tests

Only when explicitly asked. It must be completely invisible: the user is on the same
machine and must not see, hear, or be interrupted by it. Never use Playwright.

- Launch in the background so it never takes focus (`open -g` style). Pass
  `--remote-debugging-port=<port>` (renderer) and `--inspect=<port>` (main process).
- Right away, through the main-process inspector, run `app.dock.hide()`, move every
  `BrowserWindow` to about `-10000,-10000` with `setPosition`, and call
  `webContents.setBackgroundThrottling(false)`. Do the same for windows opened later.
- Keep windows shown off-screen; never `hide()` or `show: false` (hidden windows stop painting).
- Drive it only through CDP: `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`,
  `Runtime.evaluate`, `Page.captureScreenshot`. Never touch the real keyboard, mouse,
  clipboard, or screen (no AppleScript, `cliclick`, `screencapture`).
- No sound: no dictation, beeps, or notifications.
- Use a throwaway `--user-data-dir`; never collide with a running Ground Control.
- CDP client deps (`ws`, `chrome-remote-interface`) go in a temp dir, never the repo.
- Never touch the repo's `.dev-store/`. A dev build stores data in `<cwd>/.dev-store`,
  so launch Electron with its cwd set to a temp dir outside the repo.
- Never create files inside the repo. All scratch goes in a temp dir.
- When done, kill every process you started and leave `git status` exactly as found.
- Never ask the user to look at, focus, enable, or click anything.
