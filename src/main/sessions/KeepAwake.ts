import { spawn, type ChildProcess } from "node:child_process";
import { describeError, logActivity } from "../activityLog";

const CAFFEINATE_FLAGS = ["-ims", "-w", String(process.pid)];

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

	constructor(private wantsKeepAwake: (runtimeId: string) => boolean) {}

	setBusy = (runtimeId: string, busy: boolean): void => {
		if (busy) this.busy.add(runtimeId);
		else this.busy.delete(runtimeId);
		this.refresh();
	};

	refresh = (): void => {
		const wanting = [...this.busy].filter(this.wantsKeepAwake);
		this.wanting = wanting;
		if (wanting.length > 0) this.start(wanting);
		else this.stop();
	};

	status(): KeepAwakeStatus | null {
		if (!this.child) return null;
		return { pid: this.child.pid, startedAt: this.startedAt, runtimeIds: this.wanting };
	}

	dispose(): void {
		this.busy.clear();
		this.stop();
	}

	private start(wanting: string[]): void {
		if (this.child || process.platform !== "darwin") return;
		const child = spawn("caffeinate", CAFFEINATE_FLAGS, {
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
