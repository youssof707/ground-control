import { spawn, type ChildProcess } from "node:child_process";
import { describeError, logActivity } from "../activityLog";

const CAFFEINATE = "/usr/bin/caffeinate";
const CAFFEINATE_FLAGS = ["-ims", "-w", String(process.pid)];
const LINGER_MS = 60_000;
const HOLD_LABEL = "upcoming wake";

export interface KeepAwakeStatus {
	pid: number | undefined;
	startedAt: number;
	runtimeIds: string[];
}

export class KeepAwake {
	private busy = new Set<string>();
	private child: ChildProcess | null = null;
	private startedAt = 0;
	private wanting: string[] = [];
	private holdUntil = 0;
	private holdTimer: NodeJS.Timeout | null = null;
	private lingerTimer: NodeJS.Timeout | null = null;

	constructor(
		private wantsKeepAwake: (runtimeId: string) => boolean,
		private now: () => number = Date.now,
	) {}

	setBusy = (runtimeId: string, busy: boolean): void => {
		if (busy) this.busy.add(runtimeId);
		else this.busy.delete(runtimeId);
		this.refresh();
	};

	holdFor(ms: number): void {
		const until = this.now() + ms;
		if (until <= this.holdUntil) return;
		this.holdUntil = until;
		if (this.holdTimer) clearTimeout(this.holdTimer);
		this.holdTimer = setTimeout(() => {
			this.holdTimer = null;
			this.holdUntil = 0;
			this.refresh();
		}, ms);
		logActivity("caffeinate", `holding for ${Math.round(ms / 1000)}s: ${HOLD_LABEL}`);
		this.refresh();
	}

	refresh = (): void => {
		const wanting = [...this.busy].filter(this.wantsKeepAwake);
		if (this.holdUntil > this.now()) wanting.push(HOLD_LABEL);
		this.wanting = wanting;
		if (wanting.length > 0) {
			this.cancelLinger();
			this.start(wanting);
		} else {
			this.lingerThenStop();
		}
	};

	status(): KeepAwakeStatus | null {
		if (!this.child) return null;
		return { pid: this.child.pid, startedAt: this.startedAt, runtimeIds: this.wanting };
	}

	dispose(): void {
		this.busy.clear();
		this.holdUntil = 0;
		if (this.holdTimer) clearTimeout(this.holdTimer);
		this.holdTimer = null;
		this.cancelLinger();
		this.stop();
	}

	private lingerThenStop(): void {
		if (!this.child || this.lingerTimer) return;
		this.lingerTimer = setTimeout(() => {
			this.lingerTimer = null;
			this.stop();
		}, LINGER_MS);
	}

	private cancelLinger(): void {
		if (!this.lingerTimer) return;
		clearTimeout(this.lingerTimer);
		this.lingerTimer = null;
	}

	private start(wanting: string[]): void {
		if (this.child || process.platform !== "darwin") return;
		const child = spawn(CAFFEINATE, CAFFEINATE_FLAGS, {
			stdio: "ignore",
		});
		const release = () => {
			if (this.child === child) this.child = null;
		};
		child.once("exit", (code, signal) => {
			if (this.child === child) {
				logActivity(
					"caffeinate",
					`exited unexpectedly pid=${child.pid} code=${code ?? "none"} signal=${signal ?? "none"}`,
				);
			}
			release();
		});
		child.once("error", (err) => {
			logActivity("caffeinate", `failed to start: ${describeError(err)}`);
			release();
		});
		this.child = child;
		this.startedAt = Date.now();
		logActivity(
			"caffeinate",
			`on pid=${child.pid} flags=${CAFFEINATE_FLAGS.join(" ")} for ${wanting.join(", ")}`,
		);
	}

	private stop(): void {
		const child = this.child;
		if (!child) return;
		this.child = null;
		child.kill();
		logActivity("caffeinate", `off pid=${child.pid}`);
	}
}
