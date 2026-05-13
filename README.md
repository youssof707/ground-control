# Ground Control

**Mission control for AI-assisted coding.**

Ground Control is a native desktop app that turns Claude into a real coding teammate. Run multiple Claude Agent sessions in parallel — each scoped to a Git repo — review every proposed change in a unified inbox, and stay in command of what lands on disk. Built on Electron, React, and the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

![Platform](https://img.shields.io/badge/platform-macOS-blue) ![Electron](https://img.shields.io/badge/electron-42-47848F) ![Version](https://img.shields.io/badge/version-1.5.0-brightgreen) ![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

<!-- SCREENSHOT #1: hero -->
![Ground Control main window with sessions sidebar, chat, and inbox panel](./docs/screenshots/01-hero.png)
> 📸 **What to capture:** the full app window in its "lived-in" state — left sidebar with 4–6 named sessions (mix of active / idle / archived), main chat showing a real in-progress conversation with Claude (a couple of user messages, an assistant reply, and one tool call), and the right-side inbox/notes panel visible. Pick a project with a meaningful branch name. This is the marquee shot — pick the prettiest window state you can stage.

---

## Why Ground Control

- **Parallel sessions, one workspace.** Run a refactor in one tab, a bug hunt in another, a doc rewrite in a third. No more single-thread chat windows.
- **Approve every change before it lands.** Permission requests are first-class UI — nothing touches your repo without your sign-off.
- **Branch-aware safety.** Stale-branch warnings catch the "I switched branches and forgot" mistake before Claude writes to the wrong tree.
- **Plans before edits.** For high-stakes work, Claude proposes a numbered plan you can approve, reject, or revise — turning agent runs into a deliberate handoff.

---

## Features

### 1. Multi-session workspace
Spin up and switch between as many Claude sessions as you need — each scoped to its own folder, with its own history, notes, and permission state. Sessions persist across restarts. Archive the ones you're done with without losing the transcript.

<sub>`src/renderer/src/features/claude-sessions/components/SessionsList.tsx` · `SessionChat.tsx`</sub>

<!-- SCREENSHOT #2: sessions sidebar -->
![Left sidebar showing multiple Claude sessions](./docs/screenshots/02-sessions-sidebar.png)
> 📸 **What to capture:** the left sessions sidebar with 4–6 sessions visible — mix of statuses (one actively running with a spinner, a couple idle, one archived if your UI shows them inline), at least one session showing an unread badge for new activity, and the currently selected session highlighted. Crop tight to the sidebar plus a sliver of the chat area.

---

### 2. Permission & review inbox
Every action Claude wants to take — edit a file, run a command, hit the network — surfaces as a card in a unified inbox. See the tool, the target, and the context at a glance. Approve, deny, or queue for later, never miss a prompt buried in chat scroll.

<sub>`src/renderer/src/features/claude-sessions/components/InboxSidebar.tsx` · `PermissionCard.tsx`</sub>

<!-- SCREENSHOT #3: permission inbox -->
![Right-side inbox panel with a pending permission card](./docs/screenshots/03-permission-inbox.png)
> 📸 **What to capture:** the right-side inbox panel with one expanded permission card front and center — should show the tool name (e.g. `Edit` or `Bash`), the target file path or command, a snippet of what's being proposed, and the Allow / Deny buttons. Bonus if a second pending item is visible below it to convey the queue.

---

### 3. Plan approval workflow
For higher-stakes work, Claude proposes a numbered plan before touching anything. You review the steps, approve, reject, or send it back for revision — turning "vibes-based" agent runs into a deliberate, reviewable handoff.

<sub>`src/renderer/src/features/claude-sessions/components/PlanApprovalCard.tsx`</sub>

<!-- SCREENSHOT #4: plan approval -->
![Plan approval card with numbered steps and approve/reject buttons](./docs/screenshots/04-plan-approval.png)
> 📸 **What to capture:** a plan card embedded mid-conversation listing 3–6 numbered steps (descriptive, not generic), the file paths the plan mentions, and the Approve / Reject (or equivalent) controls. The plan should look like something a real developer would actually want to approve.

---

### 4. Stale-branch warnings
If you start a session on `feature/auth` and the working tree later switches to `main` underneath you, Ground Control turns the branch chip red, shows "Previously working on feature/auth," and offers a one-click Switch button to take the tree back. Claude can't quietly make edits on the wrong branch — you see it the moment you look at the session.

<sub>`src/renderer/src/design/Atoms.tsx` (`BranchChip`, `BranchChipWithDelta`, `isBranchStale`) · `src/main/sessions/git.ts`</sub>

<!-- SCREENSHOT #5: stale-branch warning -->
![Branch chip in red stale state with "Previously working on" hint and Switch button](./docs/screenshots/05-stale-branch-warning.png)
> 📸 **What to capture:** the session header in its **stale** state — the branch chip rendered in red/danger palette showing the current branch name, the muted "Previously working on `<original-branch>`" hint next to it, and the Switch button that snaps the working tree back. Stage this by starting a session on one branch and `git switch`ing to another in the same repo. Tight crop on the top of the session view.

---

### 5. Live tool runs
When Claude reads files, runs commands, or searches the repo, each tool call streams into the chat as a collapsible block. Expand to see the full output; collapse to keep the transcript scannable.

<sub>`src/renderer/src/features/claude-sessions/components/ToolPreview.tsx` · `ToolRunGroup.tsx`</sub>

<!-- SCREENSHOT #6: tool runs -->
![Grouped tool-call block in the chat, expanded to show output](./docs/screenshots/06-tool-runs.png)
> 📸 **What to capture:** a `Bash` or `Read` tool call rendered in the chat — expanded so the command/path and a few lines of output are visible. Even better: a group of 2–3 related tool calls (e.g. a Grep followed by a Read) showing the grouping behavior.

---

### 6. Ask-user-question prompts
When Claude needs a decision, it asks inline with a structured card — pick from 2–4 options instead of fishing the question out of a paragraph. Decisions flow back into the conversation cleanly.

<sub>`src/renderer/src/features/claude-sessions/components/AskUserQuestionCard.tsx`</sub>

<!-- SCREENSHOT #7: ask-user-question -->
![Inline question card with 2-3 option buttons](./docs/screenshots/07-ask-user-question.png)
> 📸 **What to capture:** a question card mid-conversation with a clear question at the top and 2–3 distinct option buttons below it. The options should read like real choices (e.g. "Use Postgres" / "Use SQLite" / "Other") — not lorem ipsum.

---

### 7. Session notes
Pin notes to a session for decisions, requirements, gotchas — anything you want to remember next time you open the thread. Notes use a rich-text editor (Tiptap + Markdown) and live alongside the chat.

<sub>`src/renderer/src/features/claude-sessions/components/notes/SessionNotesPanel.tsx` · `NoteEditor.tsx`</sub>

<!-- SCREENSHOT #8: session notes -->
![Right-side notes panel with multiple notes, one open for editing](./docs/screenshots/08-notes.png)
> 📸 **What to capture:** the right-side notes panel with 3+ notes visible (titles + one-line previews) and one note opened in the editor showing a mix of formatted content — headings, a list, maybe a code snippet. Make it feel like a real working notebook.

---

### 8. Composer with image paste
Drag, drop, or paste screenshots straight into your message. The composer is a full markdown editor with live formatting — great for writing precise prompts without leaving the keyboard.

<sub>`src/renderer/src/features/claude-sessions/components/ImagePasteTextarea.tsx`</sub>

---

### 9. Multi-window support
Open as many Ground Control windows as you want, one per project. Compare two repos side by side, or keep work and side-projects fully isolated — each window has its own sessions, its own branch state, and its own UI layout.

<sub>`src/main/windows.ts` · `src/main/index.ts`</sub>

---

## Quickstart

**Requirements:** macOS · Node 20+ · an Anthropic API key (`ANTHROPIC_API_KEY` in your environment).

```bash
npm install        # install dependencies
npm run dev        # run in development (Electron + Vite hot reload)
npm run build      # produce a packaged macOS app
```

**First run:** pick a project folder when prompted — sessions are scoped to that working directory, and Git operations run inside it.

---

## How it works

The Electron **main process** owns the Claude Agent SDK and the session store ([`src/main/sessions/SessionManager.ts`](./src/main/sessions/SessionManager.ts)) — it talks to Claude, runs Git, and persists sessions to disk so they survive restarts. The **renderer** is React 19 + Zustand, and is intentionally a thin shell over an IPC bridge. Permissions, plan approvals, and tool calls are modeled as first-class objects on the way back up, which is why the inbox UX feels native rather than bolted on.

For the full architecture write-up, see [`arch.md`](./arch.md).

---

## Status

Ground Control is at **v1.5.0** — core sessions, permissions, plan approval, notes, and Git-awareness are in daily use. Roadmap focus is on polish, multi-platform packaging, and deeper Git workflows (commit/PR authoring from inside a session). Issues and ideas welcome.

---

## License

`UNLICENSED` — replace with your chosen license when you're ready to ship publicly.
