import type { ClaudeSession } from "../../shared/schemas/claude_session";
import {
	nextFireAfter,
	type Schedule,
	type SchedulePatch,
} from "../../shared/schemas/schedules";
import * as windows from "../windows";
import * as wakeScheduler from "./wakeScheduler";
import { RESUME_GRACE_MS } from "./UsageLimitResumer";
import { describeError, logActivity } from "../activityLog";

const WAKE_LEAD_MS = 60_000;
const POST_WAKE_GRACE_MS = 15_000;
const BOOT_GRACE_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

export interface ScheduleRunnerDeps {
	list: () => Schedule[];
	get: (id: string) => Schedule | undefined;
	update: (id: string, patch: SchedulePatch) => Promise<Schedule | null>;
	startScheduledSession: (schedule: Schedule) => Promise<ClaudeSession>;
	isSessionBusy: (sessionId: string) => boolean;
	usageLimitResetsAt: () => number | undefined;
	listSessionsForSchedule: (scheduleId: string) => ClaudeSession[];
	deleteSession: (sessionId: string) => Promise<void>;
	directoryExists: (path: string) => Promise<boolean>;
	now?: () => number;
}

interface ArmedSchedule {
	id: string;
	fireAt: number;
	timer: NodeJS.Timeout | null;
	wakeKey: string | null;
}

function isFinished(session: ClaudeSession): boolean {
	return (
		session.status !== "running" && session.status !== "awaiting_permission"
	);
}

export class ScheduleRunner {
	private armed = new Map<string, ArmedSchedule>();
	private firing = new Set<string>();

	constructor(private deps: ScheduleRunnerDeps) {}

	boot(): void {
		const now = this.now();
		for (const s of this.deps.list()) {
			if (!s.enabled) continue;
			if (s.nextFireAt === undefined) {
				const next = nextFireAfter(s.kind, now);
				if (next === undefined) continue;
				void this.deps.update(s.id, { nextFireAt: next });
				this.armAt(s.id, next);
				continue;
			}
			this.armAt(
				s.id,
				s.nextFireAt,
				Math.max(s.nextFireAt - now, BOOT_GRACE_MS),
			);
		}
		this.broadcast();
	}

	upsert(schedule: Schedule): void {
		this.disarm(schedule.id);
		if (schedule.enabled && schedule.nextFireAt !== undefined) {
			this.armAt(schedule.id, schedule.nextFireAt);
		}
	}

	remove(id: string): void {
		this.disarm(id);
	}

	reconcile = (): void => {
		const now = this.now();
		if (this.armed.size > 0) {
			logActivity("schedule", `re-arming ${this.armed.size} schedules after wake`);
		}
		for (const entry of this.armed.values()) {
			this.arm(entry, Math.max(entry.fireAt - now, POST_WAKE_GRACE_MS));
		}
	};

	dispose(): void {
		for (const entry of this.armed.values()) {
			if (entry.timer) clearTimeout(entry.timer);
		}
		this.armed.clear();
	}

	private now(): number {
		return this.deps.now ? this.deps.now() : Date.now();
	}

	private broadcast(): void {
		windows.broadcast("schedules:changed", this.deps.list());
	}

	private armAt(id: string, fireAt: number, delayMs?: number): void {
		this.disarm(id);
		const entry: ArmedSchedule = { id, fireAt, timer: null, wakeKey: null };
		this.armed.set(id, entry);
		this.arm(entry, delayMs ?? fireAt - this.now());
		void wakeScheduler.scheduleWake(fireAt - WAKE_LEAD_MS).then((key) => {
			if (this.armed.get(id) === entry) entry.wakeKey = key;
			else if (key) void wakeScheduler.cancelWake(key);
		});
		logActivity("schedule", `${this.label(id)} armed for ${new Date(fireAt).toISOString()}`);
	}

	private disarm(id: string): void {
		const entry = this.armed.get(id);
		if (!entry) return;
		this.armed.delete(id);
		logActivity("schedule", `${this.label(id)} disarmed`);
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.wakeKey) void wakeScheduler.cancelWake(entry.wakeKey);
	}

	private label(id: string): string {
		const title = this.deps.get(id)?.title;
		return title ? `${id} "${title}"` : id;
	}

	private arm(entry: ArmedSchedule, delayMs: number): void {
		if (entry.timer) clearTimeout(entry.timer);
		const delay = Math.min(Math.max(delayMs, 0), MAX_TIMER_MS);
		entry.timer = setTimeout(() => this.tick(entry), delay);
	}

	private tick(entry: ArmedSchedule): void {
		if (this.armed.get(entry.id) !== entry) return;
		entry.timer = null;
		if (this.now() < entry.fireAt) {
			this.arm(entry, entry.fireAt - this.now());
			return;
		}
		this.armed.delete(entry.id);
		if (entry.wakeKey) void wakeScheduler.cancelWake(entry.wakeKey);
		void this.fire(entry.id);
	}

	private async fire(id: string): Promise<void> {
		const s = this.deps.get(id);
		if (!s || !s.enabled || this.firing.has(id)) return;
		this.firing.add(id);
		logActivity("schedule", `${this.label(id)} firing`);
		try {
			const now = this.now();
			const next =
				s.kind.type === "once" ? undefined : nextFireAfter(s.kind, now);

			const limitResetsAt = this.deps.usageLimitResetsAt();
			if (limitResetsAt !== undefined) {
				await this.rearm(id, limitResetsAt + RESUME_GRACE_MS, {
					lastSkippedAt: now,
					lastSkipReason: "usageLimit",
				});
				logActivity(
					"schedule",
					`${this.label(id)} deferred: usage limit until ${new Date(limitResetsAt).toISOString()}`,
				);
				return;
			}

			if (
				next !== undefined &&
				s.lastSessionId &&
				this.deps.isSessionBusy(s.lastSessionId)
			) {
				await this.rearm(id, next, {
					lastSkippedAt: now,
					lastSkipReason: "busy",
				});
				logActivity("schedule", `${this.label(id)} skipped: previous run ${s.lastSessionId} still busy`);
				return;
			}

			const exists = await this.deps.directoryExists(s.cwd);
			if (!this.deps.get(id)?.enabled) return;
			if (!exists) {
				logActivity("schedule", `${this.label(id)} disabled: folder "${s.cwd}" no longer exists`);
				await this.deps.update(id, {
					enabled: false,
					nextFireAt: undefined,
					lastError: `Folder "${s.cwd}" no longer exists`,
				});
				return;
			}

			const armed = await this.rearm(id, next, {
				lastFiredAt: now,
				lastError: undefined,
			});
			if (!armed) return;
			await this.spawn(s).catch(() => undefined);
		} finally {
			this.firing.delete(id);
			this.broadcast();
		}
	}

	private async rearm(
		id: string,
		next: number | undefined,
		patch: SchedulePatch,
	): Promise<boolean> {
		if (next === undefined) {
			await this.deps.update(id, {
				...patch,
				enabled: false,
				nextFireAt: undefined,
			});
			return true;
		}
		this.armAt(id, next);
		const updated = await this.deps.update(id, { ...patch, nextFireAt: next });
		if (updated?.enabled) return true;
		this.disarm(id);
		if (updated?.nextFireAt !== undefined) {
			await this.deps.update(id, { nextFireAt: undefined });
		}
		return false;
	}

	private async spawn(schedule: Schedule): Promise<ClaudeSession> {
		try {
			const session = await this.deps.startScheduledSession(schedule);
			await this.deps.update(schedule.id, { lastSessionId: session.id });
			await this.prune(schedule, session.id);
			logActivity("schedule", `${this.label(schedule.id)} started session ${session.id}`);
			return session;
		} catch (err) {
			logActivity("schedule", `${this.label(schedule.id)} spawn failed: ${describeError(err)}`);
			await this.deps.update(schedule.id, { lastError: String(err) });
			throw err;
		}
	}

	private async prune(schedule: Schedule, keepId: string): Promise<void> {
		const all = this.deps
			.listSessionsForSchedule(schedule.id)
			.sort((a, b) => b.createdAt - a.createdAt);
		for (const s of all.slice(schedule.keepLast)) {
			if (s.id === keepId) continue;
			if (!isFinished(s) || this.deps.isSessionBusy(s.id)) continue;
			try {
				await this.deps.deleteSession(s.id);
				logActivity("schedule", `${this.label(schedule.id)} pruned old session ${s.id}`);
			} catch (err) {
				logActivity("schedule", `${this.label(schedule.id)} prune of ${s.id} failed: ${describeError(err)}`);
			}
		}
	}
}
