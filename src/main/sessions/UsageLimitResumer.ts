import type { SessionStatus } from "../../shared/claude-sessions/types";
import * as windows from "../windows";
import type { UsageLimitHit } from "./SessionManager";
import * as wakeScheduler from "./wakeScheduler";
import { describeError, logActivity } from "../activityLog";

export const RESUME_GRACE_MS = 3 * 60_000;
const UNKNOWN_RETRY_MS = 30 * 60_000;
const WAKE_LEAD_MS = 60_000;
const POST_WAKE_GRACE_MS = 15_000;
const MAX_TIMER_MS = 2_147_483_647;
export const MAX_RESUME_ATTEMPTS = 5;

interface PendingResume {
	runtimeId: string;
	resumeAt: number;
	timer: NodeJS.Timeout | null;
	wakeKey: string | null;
	attempts: number;
	restored: boolean;
}

export interface SavedResumeEntry {
	runtimeId: string;
	resumeAt: number;
	attempts: number;
}

export interface PendingResumeStore {
	list: () => SavedResumeEntry[];
	save: (entry: SavedResumeEntry) => Promise<void>;
	remove: (runtimeId: string) => Promise<void>;
}

export interface UsageLimitResumerDeps {
	autoResume: (runtimeId: string) => boolean;
	status: (runtimeId: string) => SessionStatus | undefined;
	retry: (runtimeId: string) => Promise<void>;
	latestResetMs: () => number | undefined;
	store?: PendingResumeStore;
	now?: () => number;
}

export class UsageLimitResumer {
	private pending = new Map<string, PendingResume>();

	constructor(private deps: UsageLimitResumerDeps) {}

	onChange = (runtimeId: string, hit: UsageLimitHit | null): void => {
		if (hit) this.onLimitHit(runtimeId, hit.resetsAt);
		else this.cancel(runtimeId);
	};

	onLimitHit(runtimeId: string, resetsAt: number | undefined): void {
		const existing = this.pending.get(runtimeId);
		const restored = existing?.restored === true;
		if (!restored && !this.deps.autoResume(runtimeId)) return;
		const resumeAt = this.resumeAtFor(resetsAt);
		if (existing && Math.abs(existing.resumeAt - resumeAt) < 1000) return;
		const attempts = existing?.attempts ?? 0;
		this.cancel(runtimeId);

		this.track({ runtimeId, resumeAt, timer: null, wakeKey: null, attempts, restored }, resumeAt - this.now());
		logActivity(
			"auto-resume",
			`${runtimeId} hit usage limit${resetsAt === undefined ? " (reset unknown)" : ` resetting ${new Date(resetsAt).toISOString()}`}, resumes at ${new Date(resumeAt).toISOString()}`,
		);
	}

	restore(): void {
		const store = this.deps.store;
		if (!store) return;
		const now = this.now();
		for (const saved of store.list()) {
			if (this.pending.has(saved.runtimeId)) continue;
			if (this.deps.status(saved.runtimeId) !== "usage_limit") {
				void store.remove(saved.runtimeId);
				logActivity("auto-resume", `${saved.runtimeId} saved resume dropped: no longer at usage limit`);
				continue;
			}
			this.track(
				{ ...saved, timer: null, wakeKey: null, restored: true },
				Math.max(saved.resumeAt - now, POST_WAKE_GRACE_MS),
			);
			logActivity("auto-resume", `${saved.runtimeId} restored, resumes at ${new Date(saved.resumeAt).toISOString()}`);
		}
	}

	refresh(sessionId: string, sidequestId: string | undefined): void {
		for (const id of [sessionId, sidequestId]) {
			if (!id) continue;
			const wanted = this.deps.autoResume(id);
			const entry = this.pending.get(id);
			if (entry?.restored) continue;
			const pending = entry !== undefined;
			if (wanted && !pending && this.deps.status(id) === "usage_limit") {
				this.onLimitHit(id, this.deps.latestResetMs());
			} else if (!wanted && pending) {
				this.cancel(id);
			}
		}
	}

	cancel(runtimeId: string): void {
		const entry = this.pending.get(runtimeId);
		if (!entry) return;
		this.pending.delete(runtimeId);
		logActivity("auto-resume", `${runtimeId} cancelled`);
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.wakeKey) void wakeScheduler.cancelWake(entry.wakeKey);
		void this.deps.store?.remove(runtimeId);
		windows.broadcast("autoResume:changed", {
			sessionId: runtimeId,
			resumeAt: null,
		});
	}

	reconcile = (): void => {
		const now = this.now();
		if (this.pending.size > 0) {
			logActivity("auto-resume", `re-arming ${this.pending.size} pending resumes after wake`);
		}
		for (const entry of this.pending.values()) {
			this.arm(entry, Math.max(entry.resumeAt - now, POST_WAKE_GRACE_MS));
		}
	};

	wakeKeys(): string[] {
		const keys: string[] = [];
		for (const entry of this.pending.values()) if (entry.wakeKey) keys.push(entry.wakeKey);
		return keys;
	}

	nextDueIn(): number | undefined {
		const now = this.now();
		let soonest: number | undefined;
		for (const entry of this.pending.values()) {
			if (!entry.timer) continue;
			const dueIn = Math.max(entry.resumeAt - now, 0);
			if (soonest === undefined || dueIn < soonest) soonest = dueIn;
		}
		return soonest;
	}

	isPending(runtimeId: string): boolean {
		return this.pending.has(runtimeId);
	}

	list(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const [id, entry] of this.pending) out[id] = entry.resumeAt;
		return out;
	}

	dispose(): void {
		for (const entry of this.pending.values()) {
			if (entry.timer) clearTimeout(entry.timer);
		}
		this.pending.clear();
	}

	private now(): number {
		return this.deps.now ? this.deps.now() : Date.now();
	}

	private resumeAtFor(resetsAt: number | undefined): number {
		const now = this.now();
		const target = resetsAt === undefined ? undefined : resetsAt + RESUME_GRACE_MS;
		return target !== undefined && target > now ? target : now + UNKNOWN_RETRY_MS;
	}

	private track(entry: PendingResume, delayMs: number): void {
		const { runtimeId, resumeAt } = entry;
		this.pending.set(runtimeId, entry);
		this.arm(entry, delayMs);
		this.persist(entry);
		void wakeScheduler.scheduleWake(resumeAt - WAKE_LEAD_MS).then((key) => {
			if (this.pending.get(runtimeId) === entry) entry.wakeKey = key;
			else if (key) void wakeScheduler.cancelWake(key);
		});
		windows.broadcast("autoResume:changed", { sessionId: runtimeId, resumeAt });
	}

	private persist(entry: PendingResume): void {
		const { runtimeId, resumeAt, attempts } = entry;
		void this.deps.store?.save({ runtimeId, resumeAt, attempts }).catch((err) => {
			logActivity("auto-resume", `${runtimeId} save failed: ${describeError(err)}`);
		});
	}

	private arm(entry: PendingResume, delayMs: number): void {
		if (entry.timer) clearTimeout(entry.timer);
		const delay = Math.min(Math.max(delayMs, 0), MAX_TIMER_MS);
		entry.timer = setTimeout(() => this.tick(entry), delay);
	}

	private tick(entry: PendingResume): void {
		if (this.pending.get(entry.runtimeId) !== entry) return;
		entry.timer = null;
		if (this.now() < entry.resumeAt) {
			this.arm(entry, entry.resumeAt - this.now());
			return;
		}
		this.fire(entry);
	}

	private fire(entry: PendingResume): void {
		const id = entry.runtimeId;
		if (this.deps.status(id) !== "usage_limit") {
			logActivity("auto-resume", `${id} no longer at usage limit, nothing to resume`);
			this.cancel(id);
			return;
		}
		if (entry.attempts >= MAX_RESUME_ATTEMPTS) {
			logActivity("auto-resume", `${id} gave up after ${entry.attempts} attempts`);
			this.cancel(id);
			return;
		}
		entry.attempts++;
		this.persist(entry);
		logActivity("auto-resume", `${id} retrying (attempt ${entry.attempts})`);
		this.deps.retry(id).catch((err) => {
			logActivity("auto-resume", `${id} retry failed: ${describeError(err)}`);
			this.cancel(id);
		});
	}
}
