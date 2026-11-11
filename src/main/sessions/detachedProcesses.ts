import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LiveBackgroundTask } from "../../shared/claude-sessions/types";

const run = promisify(execFile);

export const SESSION_ENV_KEY = "GROUND_CONTROL_SESSION_ID";
export const DETACHED_TASK_TYPE = "detached_process";

const TASK_ID_PREFIX = "detached:";
const POLL_INTERVAL_MS = 3000;
const STOP_GRACE_MS = 3000;
const STOP_POLL_MS = 100;
const MAX_COMMAND_LENGTH = 160;
const SESSION_TAG = new RegExp(`(?:^|\\s)${SESSION_ENV_KEY}=(\\S+)`);
const PS_ENV = { ...process.env, LC_ALL: "C" };

interface ProcessInfo {
	pid: number;
	ppid: number;
	sessionId: string | null;
}

type ProcessTable = Map<number, ProcessInfo>;

async function readProcessLines(
	withEnvironment: boolean,
): Promise<Map<number, { ppid: number; text: string }>> {
	const { stdout } = await run(
		"/bin/ps",
		[withEnvironment ? "-Eww" : "-ww", "-x", "-o", "pid=,ppid=,command="],
		{ env: PS_ENV, maxBuffer: 64 * 1024 * 1024 },
	);
	const lines = new Map<number, { ppid: number; text: string }>();
	for (const line of stdout.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
		if (match) {
			lines.set(Number(match[1]), { ppid: Number(match[2]), text: match[3] });
		}
	}
	return lines;
}

async function readProcessTable(): Promise<ProcessTable> {
	const [plain, withEnvironment] = await Promise.all([
		readProcessLines(false),
		readProcessLines(true),
	]);
	const table: ProcessTable = new Map();
	for (const [pid, { ppid, text }] of withEnvironment) {
		const command = plain.get(pid)?.text;
		if (command === undefined) continue;
		const environment = text.startsWith(command)
			? text.slice(command.length)
			: "";
		table.set(pid, {
			pid,
			ppid,
			sessionId: SESSION_TAG.exec(environment)?.[1] ?? null,
		});
	}
	return table;
}

function isDetachedRoot(info: ProcessInfo, table: ProcessTable): boolean {
	if (!info.sessionId) return false;
	const seen = new Set<number>();
	let pid = info.ppid;
	while (pid > 1 && !seen.has(pid)) {
		if (pid === process.pid) return false;
		const ancestor = table.get(pid);
		if (!ancestor) return true;
		if (ancestor.sessionId === info.sessionId) return false;
		seen.add(pid);
		pid = ancestor.ppid;
	}
	return true;
}

function childrenByParent(table: ProcessTable): Map<number, number[]> {
	const children = new Map<number, number[]>();
	for (const info of table.values()) {
		const siblings = children.get(info.ppid);
		if (siblings) siblings.push(info.pid);
		else children.set(info.ppid, [info.pid]);
	}
	return children;
}

function treeOf(root: number, children: Map<number, number[]>): number[] {
	const out: number[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const pid = stack.pop() as number;
		out.push(pid);
		stack.push(...(children.get(pid) ?? []));
	}
	return out;
}

async function readListeningPorts(): Promise<Map<number, number[]>> {
	const ports = new Map<number, number[]>();
	let stdout = "";
	try {
		({ stdout } = await run(
			"/usr/sbin/lsof",
			["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"],
			{ env: PS_ENV, maxBuffer: 16 * 1024 * 1024 },
		));
	} catch (err) {
		const out = (err as { stdout?: string }).stdout;
		if (typeof out !== "string") return ports;
		stdout = out;
	}
	let pid = 0;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("p")) {
			pid = Number(line.slice(1));
		} else if (line.startsWith("n") && pid) {
			const port = Number(line.slice(line.lastIndexOf(":") + 1));
			if (!Number.isFinite(port)) continue;
			const list = ports.get(pid) ?? [];
			if (!list.includes(port)) list.push(port);
			ports.set(pid, list);
		}
	}
	return ports;
}

async function readDisplayInfo(
	pids: number[],
): Promise<Map<number, { startedAt: number; command: string }>> {
	const info = new Map<number, { startedAt: number; command: string }>();
	if (pids.length === 0) return info;
	let stdout = "";
	try {
		({ stdout } = await run(
			"/bin/ps",
			["-ww", "-o", "pid=,lstart=,command=", "-p", pids.join(",")],
			{ env: PS_ENV },
		));
	} catch (err) {
		const out = (err as { stdout?: string }).stdout;
		if (typeof out !== "string") return info;
		stdout = out;
	}
	for (const line of stdout.split("\n")) {
		const match =
			/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
		if (!match) continue;
		const startedAt = Date.parse(match[2]);
		info.set(Number(match[1]), {
			startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
			command: match[3],
		});
	}
	return info;
}

function shortenCommand(command: string): string {
	const [program, ...args] = command.trim().split(/\s+/);
	const name = program.slice(program.lastIndexOf("/") + 1);
	const short = [name, ...args].join(" ");
	return short.length > MAX_COMMAND_LENGTH
		? `${short.slice(0, MAX_COMMAND_LENGTH - 1)}…`
		: short;
}

function describe(command: string, ports: number[]): string {
	const short = shortenCommand(command);
	if (ports.length === 0) return short;
	const listening = ports
		.sort((a, b) => a - b)
		.map((p) => `:${p}`)
		.join(", ");
	return `${short} · listening on ${listening}`;
}

function pidOfTaskId(taskId: string): number | null {
	if (!taskId.startsWith(TASK_ID_PREFIX)) return null;
	const pid = Number(taskId.slice(TASK_ID_PREFIX.length));
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function signal(pids: number[], sig: NodeJS.Signals): void {
	for (const pid of pids) {
		try {
			process.kill(pid, sig);
		} catch {}
	}
}

async function terminate(pids: number[]): Promise<void> {
	signal(pids, "SIGTERM");
	const deadline = Date.now() + STOP_GRACE_MS;
	while (Date.now() < deadline && pids.some(isAlive)) {
		await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
	}
	signal(pids.filter(isAlive), "SIGKILL");
}

export class DetachedProcessWatcher {
	#tasks = new Map<string, LiveBackgroundTask[]>();
	#json = new Map<string, string>();
	#timer: NodeJS.Timeout | null = null;
	#scanning: Promise<void> | null = null;
	#rescanQueued = false;
	readonly #onChange: (sessionId: string) => void;

	constructor(onChange: (sessionId: string) => void) {
		this.#onChange = onChange;
	}

	start(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => this.scan(), POLL_INTERVAL_MS);
		this.#timer.unref?.();
		this.scan();
	}

	dispose(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	tasksFor(sessionId: string): LiveBackgroundTask[] {
		return this.#tasks.get(sessionId) ?? [];
	}

	all(): Record<string, LiveBackgroundTask[]> {
		return Object.fromEntries(this.#tasks);
	}

	owns(taskId: string): boolean {
		return pidOfTaskId(taskId) !== null;
	}

	scan(): Promise<void> {
		if (this.#scanning) {
			this.#rescanQueued = true;
			return this.#scanning;
		}
		this.#scanning = this.#scanOnce()
			.catch((err) => console.error("[ccw] detached process scan failed:", err))
			.finally(() => {
				this.#scanning = null;
				if (this.#rescanQueued) {
					this.#rescanQueued = false;
					void this.scan();
				}
			});
		return this.#scanning;
	}

	async stopTask(sessionId: string, taskId: string): Promise<void> {
		const pid = pidOfTaskId(taskId);
		if (pid === null) return;
		const table = await readProcessTable();
		const root = table.get(pid);
		if (!root || root.sessionId !== sessionId) {
			await this.scan();
			return;
		}
		await terminate(this.#taggedTree(pid, table));
		await this.scan();
	}

	async stopSession(sessionId: string): Promise<void> {
		const table = await readProcessTable().catch(() => null);
		if (!table) return;
		const pids = [...table.values()]
			.filter((info) => info.sessionId === sessionId && isDetachedRoot(info, table))
			.flatMap((info) => this.#taggedTree(info.pid, table));
		if (pids.length > 0) await terminate(pids);
		await this.scan();
	}

	#taggedTree(root: number, table: ProcessTable): number[] {
		const sessionId = table.get(root)?.sessionId;
		return treeOf(root, childrenByParent(table)).filter(
			(pid) => table.get(pid)?.sessionId === sessionId,
		);
	}

	async #scanOnce(): Promise<void> {
		const table = await readProcessTable();
		const roots = [...table.values()].filter((info) =>
			isDetachedRoot(info, table),
		);
		const [ports, display] = await Promise.all([
			roots.length > 0 ? readListeningPorts() : Promise.resolve(new Map()),
			readDisplayInfo(roots.map((r) => r.pid)),
		]);
		const next = new Map<string, LiveBackgroundTask[]>();
		for (const root of roots) {
			const shown = display.get(root.pid);
			if (!shown || !root.sessionId) continue;
			const treePorts = this.#taggedTree(root.pid, table).flatMap(
				(pid) => ports.get(pid) ?? [],
			);
			const list = next.get(root.sessionId) ?? [];
			list.push({
				id: `${TASK_ID_PREFIX}${root.pid}`,
				type: DETACHED_TASK_TYPE,
				description: describe(shown.command, [...new Set(treePorts)]),
				startedAt: shown.startedAt,
			});
			next.set(root.sessionId, list);
		}
		this.#publish(next);
	}

	#publish(next: Map<string, LiveBackgroundTask[]>): void {
		const changed = new Set<string>([...this.#tasks.keys(), ...next.keys()]);
		this.#tasks = next;
		for (const sessionId of changed) {
			const list = (next.get(sessionId) ?? []).sort(
				(a, b) => a.startedAt - b.startedAt,
			);
			const json = JSON.stringify(list);
			if ((this.#json.get(sessionId) ?? "[]") === json) continue;
			if (list.length === 0) this.#json.delete(sessionId);
			else this.#json.set(sessionId, json);
			this.#onChange(sessionId);
		}
	}
}
