import { spawn, type ChildProcess } from "node:child_process";

export class KeepAwake {
	private busy = new Set<string>();
	private child: ChildProcess | null = null;

	constructor(private wantsKeepAwake: (runtimeId: string) => boolean) {}

	setBusy = (runtimeId: string, busy: boolean): void => {
		if (busy) this.busy.add(runtimeId);
		else this.busy.delete(runtimeId);
		this.refresh();
	};

	refresh = (): void => {
		const wanted = [...this.busy].some(this.wantsKeepAwake);
		if (wanted) this.start();
		else this.stop();
	};

	dispose(): void {
		this.busy.clear();
		this.stop();
	}

	private start(): void {
		if (this.child || process.platform !== "darwin") return;
		const child = spawn("caffeinate", ["-ims", "-w", String(process.pid)], {
			stdio: "ignore",
		});
		const release = () => {
			if (this.child === child) this.child = null;
		};
		child.once("exit", release);
		child.once("error", (err) => {
			console.error("[keep-awake] caffeinate failed:", err);
			release();
		});
		this.child = child;
		console.log(`[keep-awake] caffeinate started pid=${child.pid}`);
	}

	private stop(): void {
		const child = this.child;
		if (!child) return;
		this.child = null;
		child.kill();
		console.log(`[keep-awake] caffeinate stopped pid=${child.pid}`);
	}
}
