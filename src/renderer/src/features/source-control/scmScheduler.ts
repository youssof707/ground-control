export interface RefreshRun {
	promise: Promise<number | null>;
	cancel: () => void;
}

export interface SchedulerDeps {
	run: (checkout: string) => RefreshRun;
	now: () => number;
	setTimer: (fn: () => void, ms: number) => unknown;
	clearTimer: (handle: unknown) => void;
}

interface CheckoutState {
	running: RefreshRun | null;
	trailing: boolean;
	trailingUrgent: boolean;
	timer: unknown;
	lastFinished: number;
	lastDuration: number;
}

const MIN_INTERVAL_MS = 2_000;

export function minInterval(lastDuration: number): number {
	return Math.max(MIN_INTERVAL_MS, lastDuration * 2);
}

export class RefreshScheduler {
	private readonly states = new Map<string, CheckoutState>();

	constructor(private readonly deps: SchedulerDeps) {}

	private state(checkout: string): CheckoutState {
		let st = this.states.get(checkout);
		if (!st) {
			st = {
				running: null,
				trailing: false,
				trailingUrgent: false,
				timer: null,
				lastFinished: Number.NEGATIVE_INFINITY,
				lastDuration: 0,
			};
			this.states.set(checkout, st);
		}
		return st;
	}

	lastDuration(checkout: string): number {
		return this.states.get(checkout)?.lastDuration ?? 0;
	}

	isRunning(checkout: string): boolean {
		return this.states.get(checkout)?.running != null;
	}

	request(checkout: string, urgent = false): void {
		const st = this.state(checkout);
		if (st.running) {
			st.trailing = true;
			st.trailingUrgent = st.trailingUrgent || urgent;
			return;
		}
		const wait = urgent
			? 0
			: st.lastFinished + minInterval(st.lastDuration) - this.deps.now();
		if (wait <= 0) {
			this.start(checkout, st);
			return;
		}
		if (st.timer !== null) return;
		st.timer = this.deps.setTimer(() => {
			st.timer = null;
			if (!st.running) this.start(checkout, st);
		}, wait);
	}

	cancelExcept(keep: Set<string>): void {
		for (const [checkout, st] of this.states) {
			if (keep.has(checkout)) continue;
			st.trailing = false;
			st.trailingUrgent = false;
			if (st.timer !== null) {
				this.deps.clearTimer(st.timer);
				st.timer = null;
			}
			st.running?.cancel();
		}
	}

	private start(checkout: string, st: CheckoutState): void {
		if (st.timer !== null) {
			this.deps.clearTimer(st.timer);
			st.timer = null;
		}
		const run = this.deps.run(checkout);
		st.running = run;
		const finish = (duration: number | null): void => {
			if (st.running !== run) return;
			st.running = null;
			st.lastFinished = this.deps.now();
			if (duration !== null) st.lastDuration = duration;
			if (!st.trailing) return;
			const urgent = st.trailingUrgent;
			st.trailing = false;
			st.trailingUrgent = false;
			this.request(checkout, urgent);
		};
		run.promise.then(finish, () => finish(null));
	}
}
