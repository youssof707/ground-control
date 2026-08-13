import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * How long a *provisional* background task (one we only ever learned about
 * from a `task_started`, never from a snapshot) may go unheard-from before we
 * presume it dead and stop counting it as work in progress.
 *
 * Five minutes. It has to clear the longest plausible silence of a live task:
 * background `local_bash` tasks emit nothing at all between start and
 * completion — the captured corpus has a 68 s gap (`bx5nmuif6`) during normal
 * operation — and there is no heartbeat to lean on for those. Do not drop this
 * below ~2 min. Going much higher is also bad: a leaked pin suppresses the
 * unread dot and dock badge, both of which are gated on `status !== "running"`
 * (SessionsList `useRowDerived`, `useDockUnreadBadge`).
 */
export const PROVISIONAL_TASK_TTL_MS = 5 * 60_000;

/** How often the TTL sweep runs when the SDK stream is silent. */
export const PROVISIONAL_SWEEP_INTERVAL_MS = 30_000;

/**
 * Terminal task states, unioned across the two vocabularies the CLI uses:
 * `task_updated.patch.status` (pending|running|completed|failed|killed) and
 * `task_notification.status` (completed|failed|stopped). One set tolerates
 * either side gaining a value without us having to care which emitted it.
 */
const TERMINAL_TASK_STATUSES = new Set([
	"completed",
	"failed",
	"killed",
	"stopped",
]);

/**
 * Read `subtype` off a system message defensively, as a plain string.
 *
 * We spawn the user's **global** `claude` binary whenever one exists (see
 * `resolveClaudeBinary`), and that binary is routinely newer than the
 * `sdk.d.ts` we compile against. Subtypes like `background_tasks_changed`
 * and `thinking_tokens` are emitted by the CLI today but aren't in the SDK's
 * `SDKMessage` union at all — so `msg.subtype === "background_tasks_changed"`
 * doesn't even typecheck. Reading through a cast makes an unknown subtype a
 * silent no-op instead of a compile error or a runtime crash.
 */
export function systemSubtype(msg: SDKMessage): string | null {
	if (msg.type !== "system") return null;
	const st = (msg as { subtype?: unknown }).subtype;
	return typeof st === "string" ? st : null;
}

/**
 * Task ids from a `background_tasks_changed` snapshot.
 *
 * Returns `null` — not `[]` — when `tasks` isn't an array. That distinction
 * is load-bearing: a malformed or renamed payload must be *ignored*, never
 * mistaken for "no background tasks are running".
 */
function backgroundTaskIds(msg: SDKMessage): string[] | null {
	const tasks = (msg as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) return null;
	const ids: string[] = [];
	for (const t of tasks) {
		const id = (t as { task_id?: unknown })?.task_id;
		if (typeof id === "string") ids.push(id);
	}
	return ids;
}

function taskIdOf(msg: SDKMessage): string | null {
	const id = (msg as { task_id?: unknown }).task_id;
	return typeof id === "string" ? id : null;
}

/** The tool_use that spawned a task — our link to its subagent's messages. */
function toolUseIdOf(msg: SDKMessage): string | null {
	const id = (msg as { tool_use_id?: unknown }).tool_use_id;
	return typeof id === "string" ? id : null;
}

function parentToolUseIdOf(msg: SDKMessage): string | null {
	const id = (msg as { parent_tool_use_id?: unknown }).parent_tool_use_id;
	return typeof id === "string" ? id : null;
}

/**
 * True when a `task_updated` / `task_notification` means the task is over.
 * Reads both fields — `task_notification` carries `status` at the top level,
 * `task_updated` nests it under `patch`.
 */
function taskStatusIsTerminal(msg: SDKMessage): boolean {
	const m = msg as { status?: unknown; patch?: { status?: unknown } };
	if (typeof m.status === "string" && TERMINAL_TASK_STATUSES.has(m.status)) {
		return true;
	}
	const patched = m.patch?.status;
	return typeof patched === "string" && TERMINAL_TASK_STATUSES.has(patched);
}

interface ProvisionalTask {
	lastSeen: number;
	toolUseId: string | null;
}

export interface SessionActivityOptions {
	/** Seeded true when the session was created with a prompt already queued. */
	initiallyActive: boolean;
	/** Called after every fold. Deduping is the caller's job, not ours. */
	onChange: () => void;
	/** Injectable clock — the replay harness drives this off message timestamps. */
	now?: () => number;
	ttlMs?: number;
}

/**
 * Tracks whether a session is doing work.
 *
 * A session is "working" iff EITHER a top-level turn is in flight OR at least
 * one background task is still alive. The second half exists because newer CLI
 * builds background their subagents, emit a top-level `result` when the *main*
 * turn ends while those subagents keep running, and then re-enter the loop by
 * themselves (no user turn from us) once one finishes.
 *
 * ── Why there are two task sets ──────────────────────────────────────────────
 * `background_tasks_changed` snapshots are authoritative, but only for
 * **top-level** background tasks. Tasks spawned *beneath* a subagent are never
 * listed in them. Captured proof, session `c1bb81ae`: `local_bash` task
 * `bs12k56lo` (a polling loop the CLI auto-backgrounded on a subagent's behalf)
 * starts at t=58.4s and completes at t=83.7s, and appears in **zero** of that
 * session's 16 snapshots — including the four that fire while it is alive. The
 * top-level `result` lands at t=67.8s. Had nothing else been running, the pill
 * would have read "idle" for the 16 s that task had left.
 *
 * So `task_started` must also be able to grow the set — but its ids can only be
 * held *provisionally*, because we cannot prove the CLI will always close them.
 * Hence:
 *
 *   - `#snapshot`    — replaced wholesale by each snapshot. Same as it ever was.
 *   - `#provisional` — grown by `task_started`, and TTL-expiring.
 *
 * The reconcile between them is **promotion, not pruning**. When a snapshot
 * names an id, that id is henceforth governed by the snapshot, so we drop it
 * from `#provisional`. An id a snapshot *doesn't* name is not "finished" — it
 * is simply outside that snapshot's scope (`bs12k56lo`), and must survive.
 * Pruning on absence would have evicted `bs12k56lo` at t=63.8s, 20 s early.
 *
 * Because snapshots reliably arrive *before* `task_started` for top-level
 * tasks, those ids never enter `#provisional` at all — which is why this is a
 * no-op on well-behaved builds (verified by replay over the captured corpus).
 *
 * ── The anti-stuck guarantee ─────────────────────────────────────────────────
 * The TTL applies to `#provisional` only, never `#snapshot`. So: every "running"
 * pin this class can introduce beyond what the snapshot alone would justify
 * expires within `TTL + sweep interval`, after which the answer collapses back
 * to the snapshot-only one. This can never be stuck on "running" indefinitely.
 */
export class SessionActivity {
	#turnActive: boolean;
	#snapshot = new Set<string>();
	#provisional = new Map<string, ProvisionalTask>();
	/** True once *we* have asked for work (initial prompt or composer message). */
	#anyTurnPushed: boolean;
	#messagesSeen = 0;
	/**
	 * Set by `hardStop()` (i.e. interrupt), cleared by the next user turn.
	 *
	 * `interrupt()` relies on everything the CLI emits in its post-interrupt
	 * tail being *shrink-only* — `task_updated{killed}`, `task_notification
	 * {stopped}`, `result{error_during_execution}` all either clear the turn or
	 * remove tasks, so nothing can flip the session back to "running" after the
	 * user hit stop. Making `task_started` a growth source would have quietly
	 * broken that. This flag keeps it true.
	 */
	#hardStopped = false;
	readonly #onChange: () => void;
	readonly #now: () => number;
	readonly #ttlMs: number;

	constructor(opts: SessionActivityOptions) {
		this.#turnActive = opts.initiallyActive;
		this.#anyTurnPushed = opts.initiallyActive;
		this.#onChange = opts.onChange;
		this.#now = opts.now ?? Date.now;
		this.#ttlMs = opts.ttlMs ?? PROVISIONAL_TASK_TTL_MS;
	}

	get isActive(): boolean {
		return (
			this.#turnActive || this.#snapshot.size > 0 || this.#provisional.size > 0
		);
	}

	get debug(): { turn: boolean; bg: number; prov: number } {
		return {
			turn: this.#turnActive,
			bg: this.#snapshot.size,
			prov: this.#provisional.size,
		};
	}

	/** Fold one SDK message into the model, then notify. */
	apply(msg: SDKMessage): void {
		this.#messagesSeen++;
		const now = this.#now();
		this.#sweep(now);

		// Heartbeat. Every message a subagent emits carries the tool_use id of
		// the Agent call that spawned it, so a live `local_agent` task is
		// refreshed constantly and can never be TTL-evicted mid-flight (the
		// corpus shows 14–29 such messages per agent task). `local_bash` tasks
		// are opaque and get none — they lean on the TTL alone, which is why it
		// is measured in minutes. Linear scan: this map holds ~10 entries at
		// most, and a reverse index would just be another thing to keep in sync
		// across task-id reuse.
		const parent = parentToolUseIdOf(msg);
		if (parent !== null) {
			for (const entry of this.#provisional.values()) {
				if (entry.toolUseId === parent) entry.lastSeen = now;
			}
		}

		if (msg.type === "result") {
			// A `result` ends the top-level turn. It does NOT mean the session
			// stopped working — background subagents routinely outlive it.
			// Assuming otherwise *was* the bug.
			this.#turnActive = false;
		} else if (msg.type === "assistant") {
			// Top-level assistant output means the main loop is alive. Defensive
			// re-arm for CLI builds that self-resume without re-emitting `init`.
			// Loose `== null` covers a missing field.
			if (msg.parent_tool_use_id == null) this.#turnActive = true;
		} else {
			switch (systemSubtype(msg)) {
				case "init":
					// Guarded so a connect-time handshake on a bare resume() can't
					// light the pill with nothing to turn it back off.
					if (this.#anyTurnPushed || this.#messagesSeen > 1) {
						this.#turnActive = true;
					}
					break;
				case "background_tasks_changed": {
					const ids = backgroundTaskIds(msg);
					if (ids) {
						this.#snapshot = new Set(ids);
						// Promotion, not pruning — see the class docblock.
						for (const tid of ids) this.#provisional.delete(tid);
					}
					break;
				}
				case "task_started": {
					const tid = taskIdOf(msg);
					// Skip ids the snapshot already owns (the common case for
					// top-level tasks) so this stays a no-op on builds whose
					// snapshots are complete.
					if (tid && !this.#hardStopped && !this.#snapshot.has(tid)) {
						this.#provisional.set(tid, {
							lastSeen: now,
							toolUseId: toolUseIdOf(msg),
						});
					}
					break;
				}
				case "task_progress": {
					const entry = this.#peek(msg);
					if (entry) entry.lastSeen = now;
					break;
				}
				case "task_updated":
				case "task_notification": {
					const tid = taskIdOf(msg);
					if (!tid) break;
					if (taskStatusIsTerminal(msg)) {
						// No-op on unknown ids — foreground tasks, which never
						// enter either set, close out through here constantly.
						this.#snapshot.delete(tid);
						this.#provisional.delete(tid);
					} else {
						const entry = this.#provisional.get(tid);
						if (entry) entry.lastSeen = now;
					}
					break;
				}
			}
		}

		this.#onChange();
	}

	/** A user turn was pushed: arm the turn and lift any interrupt latch. */
	noteUserTurn(): void {
		this.#anyTurnPushed = true;
		this.#turnActive = true;
		this.#hardStopped = false;
	}

	/**
	 * Hard stop, used by `interrupt()`. Clears everything: an interrupt kills
	 * in-flight background tasks too, and the CLI isn't guaranteed to emit their
	 * closures afterwards — so we must not leave ghost ids pinning "running".
	 */
	hardStop(): void {
		this.#turnActive = false;
		this.#snapshot.clear();
		this.#provisional.clear();
		this.#hardStopped = true;
	}

	/**
	 * Timer-driven TTL sweep. Necessary because the message-driven sweep in
	 * `apply()` cannot fire in the exact situation it exists for: a leaked
	 * provisional entry with a silent stream. Only notifies if it evicted
	 * something.
	 */
	tick(): void {
		if (this.#sweep(this.#now())) this.#onChange();
	}

	#peek(msg: SDKMessage): ProvisionalTask | undefined {
		const tid = taskIdOf(msg);
		return tid ? this.#provisional.get(tid) : undefined;
	}

	/** Returns true if anything was evicted. */
	#sweep(now: number): boolean {
		let evicted = false;
		for (const [tid, entry] of this.#provisional) {
			if (now - entry.lastSeen >= this.#ttlMs) {
				this.#provisional.delete(tid);
				evicted = true;
			}
		}
		return evicted;
	}
}
