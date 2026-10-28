import type { SessionStatus } from "../../shared/claude-sessions/types";
import * as windows from "../windows";
import type { UsageLimitHit } from "./SessionManager";
import * as wakeScheduler from "./wakeScheduler";

export const RESUME_GRACE_MS = 3 * 60_000;
const UNKNOWN_RETRY_MS = 30 * 60_000;
const WAKE_LEAD_MS = 60_000;
const POST_WAKE_GRACE_MS = 15_000;
const MAX_TIMER_MS = 2_147_483_647;

interface PendingResume {
	runtimeId: string;
	resumeAt: number;
	timer: NodeJS.Timeout | null;
	wakeKey: string | null;
	attempts: number;
}

export interface UsageLimitResumerDeps {
	autoResume: (runtimeId: string) => boolean;
	status: (runtimeId: string) => SessionStatus | undefined;
	retry: (runtimeId: string) => Promise<void>;
	latestResetMs: () => number | undefined;
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
		if (!this.deps.autoResume(runtimeId)) return;
		const resumeAt = this.resumeAtFor(resetsAt);
		const existing = this.pending.get(runtimeId);
		if (existing && Math.abs(existing.resumeAt - resumeAt) < 1000) return;
		const attempts = existing?.attempts ?? 0;
		this.cancel(runtimeId);

		const entry: PendingResume = {
			runtimeId,
			resumeAt,
			timer: null,
			wakeKey: null,
			attempts,
		};
		this.pending.set(runtimeId, entry);
		this.arm(entry, resumeAt - this.now());
		void wakeScheduler.scheduleWake(resumeAt - WAKE_LEAD_MS).then((key) => {
			if (this.pending.get(runtimeId) === entry) entry.wakeKey = key;
			else if (key) void wakeScheduler.cancelWake(key);
		});
		console.log(
			`[auto-resume] ${runtimeId} resumes at ${new Date(resumeAt).toISOString()}`,
		);
		windows.broadcast("autoResume:changed", { sessionId: runtimeId, resumeAt });
	}

	refresh(sessionId: string, sidequestId: string | undefined): void {
		for (const id of [sessionId, sidequestId]) {
			if (!id) continue;
			const wanted = this.deps.autoResume(id);
			const pending = this.pending.has(id);
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
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.wakeKey) void wakeScheduler.cancelWake(entry.wakeKey);
		windows.broadcast("autoResume:changed", {
			sessionId: runtimeId,
			resumeAt: null,
		});
	}

	reconcile = (): void => {
		const now = this.now();
		for (const entry of this.pending.values()) {
			this.arm(entry, Math.max(entry.resumeAt - now, POST_WAKE_GRACE_MS));
		}
	};

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
			this.cancel(id);
			return;
		}
		entry.attempts++;
		console.log(`[auto-resume] ${id} retrying (attempt ${entry.attempts})`);
		this.deps.retry(id).catch((err) => {
			console.error(`[auto-resume] ${id} retry failed:`, err);
			this.cancel(id);
		});
	}
}
