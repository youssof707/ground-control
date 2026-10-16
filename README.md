# Ground Control

A desktop app for running many Claude Code sessions side by side.

Website: https://ground-control-eosin.vercel.app

## Babysitter

**Let it answer for you.** Per session, pick what happens to plan approvals, permission requests, and questions while you're away.

- Approve, deny, or answer with a message you wrote.
- Prompts already waiting get answered when you save.

`⌘⇧B` opens the babysitter for the active session.

## Sidequest

**Ask a side question without touching the main thread.** Select some text and press `⌘S`. A temporary fork opens on the right with the same context up to that point.

- Runs in parallel with the main session.
- Nothing it says goes back into the session.
- Keep it, and it becomes a real session. Close it, and it's gone.

## Overview

**All your sessions in one window.** Sessions on the left, the conversation on the right. Unread replies get a dot so you can see which ones need you.

- Each session is its own Claude Code process.
- Counts at the top show how many are running, editing, or waiting.

## Statuses

**See what every session is doing.** Running, planning, planning complete, waiting for input, done, errored. The pill on each row tells you without opening it.

## Inbox

**Everything waiting on you, in one list.** Plan approvals, permission requests, and questions from every session. Answer them here instead of switching sessions to find them.

## Background tasks

**Background work, listed.** Shell commands, agents, and workflows that are still running, with how long they've been going. Stop any of them from the list.

## Worktrees

**One session, one checkout.** Give a session its own git worktree and branch so parallel sessions don't edit the same files.

- See which sessions use each worktree.
- Remove the ones nothing is using.

## Session groups

**Group related sessions.** Put sessions in named, colored groups. Collapse a group and its header still shows how many are running or waiting.

## Tokens and context

**Know how much context is left.** Input, output, and context tokens for every session, next to the model it's using. Rate-limit reset time sits in the sidebar.

## Model picker

**Switch models mid-session.** Changing model while Claude is working stops the turn, switches, and continues on its own.

`⌘⇧M` opens the model picker.

## Skills and shortcuts

**Skills and your own shortcuts, one menu.** Lists the skills in `~/.claude/skills` and the prompts you've saved. Pick one and it goes into the composer.

- A shortcut is a name, a prompt, and a mode.
- Skills come straight from your Claude Code setup.

`⌘K` opens the shortcut menu.

## Running from source

Requires macOS, Node 20+, and an Anthropic API key (`ANTHROPIC_API_KEY` in your environment).

```bash
npm install
npm run dev
npm run build
```

The landing page lives in `site/`:

```bash
npm run landing
npm run landing:build
```

## License

UNLICENSED
