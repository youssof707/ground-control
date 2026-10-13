import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { LiveBackgroundTask } from "../../shared/claude-sessions/types";
import { nextCronFire } from "./cronSchedule";

const RECURRING_CRON_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const SCHEDULING_TOOLS = new Set(["ScheduleWakeup", "CronCreate", "CronDelete"]);

interface ToolCall {
	name: string;
	input: Record<string, unknown>;
}

interface Wakeup {
	description: string;
	startedAt: number;
	dueAt: number;
}

interface CronJob {
	description: string;
	cron: string;
	recurring: boolean;
	schedule: string | undefined;
	startedAt: number;
	nextFire: number | null;
	expiresAt: number | null;
}

type Block = Record<string, unknown>;

function contentBlocks(msg: SDKMessage): Block[] {
	const content = (msg as { message?: { content?: unknown } }).message?.content;
	if (!Array.isArray(content)) return [];
	return content.filter((b): b is Block => typeof b === "object" && b !== null);
}

function asRecord(v: unknown): Record<string, unknown> {
	return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export class ScheduledWork {
	#calls = new Map<string, ToolCall>();
	#wakeup: Wakeup | null = null;
	#crons = new Map<string, CronJob>();

	apply(msg: SDKMessage, now: number): boolean {
		if (msg.type === "assistant") {
			for (const b of contentBlocks(msg)) {
				const id = str(b.id);
				const name = str(b.name);
				if (b.type === "tool_use" && id && name && SCHEDULING_TOOLS.has(name)) {
					this.#calls.set(id, { name, input: asRecord(b.input) });
				}
			}
			return false;
		}
		if (msg.type !== "user" || this.#calls.size === 0) return false;
		let changed = false;
		const result = asRecord((msg as { tool_use_result?: unknown }).tool_use_result);
		for (const b of contentBlocks(msg)) {
			const id = str(b.tool_use_id);
			if (b.type !== "tool_result" || !id) continue;
			const call = this.#calls.get(id);
			if (!call) continue;
			this.#calls.delete(id);
			if (b.is_error === true) continue;
			this.#settle(call, result, now);
			changed = true;
		}
		return changed;
	}

	#settle(call: ToolCall, result: Record<string, unknown>, now: number): void {
		const { name, input } = call;
		if (name === "ScheduleWakeup") {
			if (input.stop === true) {
				this.#wakeup = null;
				return;
			}
			const delay = num(input.delaySeconds) ?? 0;
			this.#wakeup = {
				description: str(input.reason) ?? str(input.prompt) ?? "",
				startedAt: now,
				dueAt: num(result.scheduledFor) ?? now + delay * 1000,
			};
			return;
		}
		if (name === "CronCreate") {
			const jobId = str(result.id);
			const cron = str(input.cron);
			if (!jobId || !cron) return;
			const recurring = typeof result.recurring === "boolean"
				? result.recurring
				: input.recurring !== false;
			this.#crons.set(jobId, {
				description: str(input.prompt) ?? "",
				cron,
				recurring,
				schedule: str(result.humanSchedule),
				startedAt: now,
				nextFire: nextCronFire(cron, now),
				expiresAt: recurring ? now + RECURRING_CRON_LIFETIME_MS : null,
			});
			return;
		}
		if (name === "CronDelete") {
			const jobId = str(result.id) ?? str(input.id);
			if (jobId) this.#crons.delete(jobId);
		}
	}

	sweep(now: number): boolean {
		let changed = false;
		if (this.#wakeup && now >= this.#wakeup.dueAt) {
			this.#wakeup = null;
			changed = true;
		}
		for (const [jobId, job] of this.#crons) {
			const expired = job.expiresAt !== null && now >= job.expiresAt;
			const fired = job.nextFire !== null && now >= job.nextFire;
			if (expired || (fired && !job.recurring)) {
				this.#crons.delete(jobId);
				changed = true;
			} else if (fired) {
				job.nextFire = nextCronFire(job.cron, now);
				changed = true;
			}
		}
		return changed;
	}

	get tasks(): LiveBackgroundTask[] {
		const out: LiveBackgroundTask[] = [];
		if (this.#wakeup) {
			out.push({
				id: "wakeup",
				type: "wakeup",
				description: this.#wakeup.description,
				startedAt: this.#wakeup.startedAt,
				dueAt: this.#wakeup.dueAt,
			});
		}
		for (const [jobId, job] of this.#crons) {
			out.push({
				id: jobId,
				type: "cron",
				description: job.description,
				startedAt: job.startedAt,
				dueAt: job.nextFire ?? undefined,
				schedule: job.schedule ?? job.cron,
			});
		}
		return out;
	}
}
