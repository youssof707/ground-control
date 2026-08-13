/**
 * Replay captured session transcripts through the running/idle state machine.
 *
 * This is the closest thing `SessionActivity` has to a test. The bug it guards
 * against — the status pill reading "idle" while background subagents are still
 * working — depends on which `claude` CLI build a machine has installed, so it
 * reproduces for some users and never for others. Replaying real captured
 * streams is the only way to check the logic without that machine in hand.
 *
 * Usage:
 *   node scripts/replay-activity.ts [path/to/claude_sessions.json] [flags]
 *
 * Flags:
 *   --strip-snapshots   Drop every `background_tasks_changed` message before
 *                       replaying, simulating a CLI build (or a nested-subagent
 *                       task) whose background work is never announced by a
 *                       snapshot. THIS IS THE REGRESSION CHECK for the bug.
 *   --verbose           Print every task/result/init event, not just flips.
 *
 * It prints, per session, the transition timeline under both the legacy model
 * (snapshot as the only growth source) and the current one, so a diff is
 * obvious. Deliberately a printer, not an assertion suite: `.dev-store` is
 * gitignored, so the corpus isn't reproducible on another machine.
 *
 * Expected on the corpus this was developed against (`.dev-store`, Aug 2026):
 *
 *   session     as recorded            --strip-snapshots
 *   c1bb81ae    legacy 3 / current 3   legacy 9 / current 3
 *   10a18312    legacy 10 / current 10 legacy 10 / current 10
 *
 * The two "as recorded" columns matching is what proves the change is a no-op
 * on well-behaved streams. The 9 -> 3 is the fix: under the legacy model that
 * session shows false-idle windows of 21s, 18s and 68s.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import {
	SessionActivity,
	systemSubtype,
} from "../src/main/sessions/sessionActivity.ts";

/**
 * Persisted transcript entries are stored as `unknown`, and these captures
 * predate/postdate whatever `sdk.d.ts` we compile against — so they're read as
 * loose records and cast at the one point they enter the state machine.
 */
type Msg = Record<string, unknown>;

const asSdkMessage = (c: Msg) => c as unknown as SDKMessage;

const args = process.argv.slice(2);
const stripSnapshots = args.includes("--strip-snapshots");
const verbose = args.includes("--verbose");
const storePath =
	args.find((a) => !a.startsWith("--")) ?? ".dev-store/claude_sessions.json";

/**
 * The pre-fix model, reimplemented verbatim for comparison: `turnActive` plus a
 * single task set that only ever grows from a `background_tasks_changed`
 * snapshot. Kept here rather than imported so it stays frozen as a baseline
 * even as the real implementation moves on.
 */
function legacyReplay(messages: Msg[]): string[] {
	const TERMINAL = new Set(["completed", "failed", "killed", "stopped"]);
	let turnActive = false;
	let anyTurnPushed = false;
	let seen = 0;
	const bg = new Set<string>();
	let status = "idle";
	const flips: string[] = [];
	const t0 = Number(messages[0]?.ts ?? 0);

	for (const m of messages) {
		const c = (m.content ?? m) as Msg;
		seen++;
		if (c.type === "result") {
			turnActive = false;
		} else if (c.type === "assistant") {
			if (c.parent_tool_use_id == null) turnActive = true;
		} else if (c.type === "system") {
			const st = c.subtype;
			if (st === "init") {
				if (anyTurnPushed || seen > 1) turnActive = true;
			} else if (st === "background_tasks_changed") {
				const tasks = c.tasks;
				if (Array.isArray(tasks)) {
					bg.clear();
					for (const t of tasks) {
						const id = (t as Msg)?.task_id;
						if (typeof id === "string") bg.add(id);
					}
				}
			} else if (st === "task_updated" || st === "task_notification") {
				const s = c.status ?? (c.patch as Msg | undefined)?.status;
				if (typeof s === "string" && TERMINAL.has(s)) {
					const id = c.task_id;
					if (typeof id === "string") bg.delete(id);
				}
			}
		}
		const next = turnActive || bg.size > 0 ? "running" : "idle";
		if (next !== status) {
			status = next;
			const rel = ((Number(m.ts) - t0) / 1000).toFixed(1);
			flips.push(`${rel.padStart(7)}s ${next}`);
		}
	}
	return flips;
}

function currentReplay(messages: Msg[]): string[] {
	const flips: string[] = [];
	const t0 = Number(messages[0]?.ts ?? 0);
	let now = t0;
	let status = "idle";

	const activity = new SessionActivity({
		initiallyActive: false,
		now: () => now,
		onChange: () => {
			const next = activity.isActive ? "running" : "idle";
			if (next === status) return;
			status = next;
			const d = activity.debug;
			const rel = ((now - t0) / 1000).toFixed(1);
			flips.push(
				`${rel.padStart(7)}s ${next} (turn=${d.turn} bg=${d.bg} prov=${d.prov})`,
			);
		},
	});

	for (const m of messages) {
		now = Number(m.ts);
		const c = (m.content ?? m) as Msg;
		activity.apply(asSdkMessage(c));
		if (verbose) {
			const sub = systemSubtype(asSdkMessage(c));
			if (sub && sub !== "task_progress") {
				const rel = ((now - t0) / 1000).toFixed(1);
				console.log(
					`      ${rel.padStart(7)}s . ${sub} ${String(c.task_id ?? "")}`,
				);
			}
		}
	}
	return flips;
}

const raw = JSON.parse(readFileSync(storePath, "utf8")) as {
	items?: Record<string, { title?: string; messages?: Msg[] }>;
};
const items = raw.items ?? {};

console.log(
	`replay: ${storePath}${stripSnapshots ? "  [--strip-snapshots]" : ""}\n`,
);

for (const [id, session] of Object.entries(items)) {
	let messages = session.messages ?? [];
	if (messages.length === 0) continue;
	if (stripSnapshots) {
		messages = messages.filter((m) => {
			const c = (m.content ?? m) as Msg;
			return c.subtype !== "background_tasks_changed";
		});
	}

	const legacy = legacyReplay(messages);
	const current = currentReplay(messages);
	const same = legacy.length === current.length;

	console.log(
		`== ${id.slice(0, 8)}  ${JSON.stringify(session.title ?? "").slice(0, 56)}`,
	);
	console.log(
		`   legacy ${String(legacy.length).padStart(2)} transitions` +
			`   current ${String(current.length).padStart(2)} transitions` +
			`   ${same ? "(same)" : "<-- DIFFERS"}`,
	);
	if (!same) {
		console.log("   legacy:");
		for (const f of legacy) console.log(`     ${f}`);
	}
	console.log("   current:");
	for (const f of current) console.log(`     ${f}`);
	console.log("");
}
