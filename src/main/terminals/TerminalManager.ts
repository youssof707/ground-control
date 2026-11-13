import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";
import { spawn, type IPty } from "node-pty";
import {
	MAX_TERMINAL_GROUP_SIZE,
	type TerminalDataEvent,
	type TerminalInfo,
	type TerminalSnapshot,
} from "../../shared/schemas/terminals";
import { directoryExists } from "../sessions/fsUtils";
import { LastLineTracker } from "./lastLine";

const MAX_SCROLLBACK_CHARS = 256_000;
const CHANGED_THROTTLE_MS = 150;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const FOREGROUND_POLL_MS = 1000;
const MAX_NAME_CHARS = 80;

interface TerminalEntry {
	pty: IPty;
	shellName: string;
	info: TerminalInfo;
	buffer: string;
	seq: number;
	lastLine: LastLineTracker;
}

export interface TerminalEvents {
	data: (event: TerminalDataEvent) => void;
	changed: (terminals: TerminalInfo[]) => void;
}

export class TerminalManager {
	private readonly entries = new Map<string, TerminalEntry>();
	private changedTimer: NodeJS.Timeout | null = null;
	private foregroundTimer: NodeJS.Timeout | null = null;

	constructor(private readonly events: TerminalEvents) {}

	list(): TerminalInfo[] {
		return [...this.entries.values()]
			.map((entry) => entry.info)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	async create(
		requestedCwd: string | undefined,
		splitFrom?: string,
	): Promise<TerminalInfo | null> {
		const group = splitFrom ? this.groupOf(splitFrom) : [];
		if (splitFrom && (group.length === 0 || group.length >= MAX_TERMINAL_GROUP_SIZE)) {
			return null;
		}
		const source = group[0]?.info;
		const preferredCwd = source?.cwd ?? requestedCwd;
		const cwd =
			preferredCwd && (await directoryExists(preferredCwd))
				? preferredCwd
				: homedir();
		const shell = process.env.SHELL ?? "/bin/zsh";
		const pty = spawn(shell, ["-l"], {
			name: "xterm-256color",
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
			cwd,
			env: { ...process.env, TERM: "xterm-256color" },
		});
		const entry: TerminalEntry = {
			pty,
			shellName: basename(shell),
			info: {
				id: randomUUID(),
				groupId: source?.groupId ?? randomUUID(),
				name: source?.name,
				cwd,
				status: "idle",
				lastLine: "",
				lastLineAt: 0,
				createdAt: Date.now(),
			},
			buffer: "",
			seq: 0,
			lastLine: new LastLineTracker(),
		};
		this.entries.set(entry.info.id, entry);
		pty.onData((data) => this.handleData(entry, data));
		pty.onExit(({ exitCode, signal }) =>
			this.handleExit(entry, exitCode, signal),
		);
		this.ensureForegroundPolling();
		this.emitChanged();
		return entry.info;
	}

	snapshot(id: string): TerminalSnapshot | null {
		const entry = this.entries.get(id);
		return entry ? { data: entry.buffer, seq: entry.seq } : null;
	}

	write(id: string, data: string): void {
		const entry = this.entries.get(id);
		if (!entry || !isAlive(entry)) return;
		entry.lastLine.input(data);
		entry.pty.write(data);
	}

	renameGroup(groupId: string, name: string): void {
		const trimmed = name.trim().slice(0, MAX_NAME_CHARS);
		for (const entry of this.entries.values()) {
			if (entry.info.groupId !== groupId) continue;
			entry.info = { ...entry.info, name: trimmed || undefined };
		}
		this.emitChanged();
	}

	killGroup(groupId: string): void {
		for (const entry of [...this.entries.values()]) {
			if (entry.info.groupId !== groupId) continue;
			this.entries.delete(entry.info.id);
			this.killPty(entry);
		}
		this.emitChanged();
	}

	private groupOf(id: string): TerminalEntry[] {
		const groupId = this.entries.get(id)?.info.groupId;
		if (!groupId) return [];
		return [...this.entries.values()]
			.filter((entry) => entry.info.groupId === groupId)
			.sort((a, b) => a.info.createdAt - b.info.createdAt);
	}

	resize(id: string, cols: number, rows: number): void {
		const entry = this.entries.get(id);
		if (!entry || !isAlive(entry)) return;
		if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
		if (cols < 2 || rows < 1) return;
		try {
			entry.pty.resize(cols, rows);
		} catch {
			return;
		}
	}

	kill(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		this.killPty(entry);
		this.emitChanged();
	}

	disposeAll(): void {
		if (this.changedTimer) clearTimeout(this.changedTimer);
		this.changedTimer = null;
		this.stopForegroundPolling();
		for (const entry of this.entries.values()) this.killPty(entry);
		this.entries.clear();
	}

	private killPty(entry: TerminalEntry): void {
		if (!isAlive(entry)) return;
		try {
			entry.pty.kill();
		} catch {
			return;
		}
	}

	private append(entry: TerminalEntry, data: string): void {
		entry.buffer = (entry.buffer + data).slice(-MAX_SCROLLBACK_CHARS);
		entry.seq += data.length;
		this.events.data({ id: entry.info.id, data, seq: entry.seq });
	}

	private handleData(entry: TerminalEntry, data: string): void {
		if (this.entries.get(entry.info.id) !== entry) return;
		this.append(entry, data);
		if (!entry.lastLine.push(data)) return;
		this.syncLastLine(entry);
		this.scheduleChanged();
	}

	private syncLastLine(entry: TerminalEntry): void {
		entry.info = {
			...entry.info,
			lastLine: entry.lastLine.value,
			lastLineAt: Date.now(),
		};
	}

	private handleExit(
		entry: TerminalEntry,
		exitCode: number,
		signal: number | undefined,
	): void {
		if (this.entries.get(entry.info.id) !== entry) return;
		if (exitCode === 0 && !signal) {
			this.entries.delete(entry.info.id);
			this.emitChanged();
			return;
		}
		entry.info = { ...entry.info, status: "crashed", exitCode };
		this.append(
			entry,
			`\r\n\x1b[31m[process exited with code ${exitCode}]\x1b[0m\r\n`,
		);
		this.emitChanged();
	}

	private ensureForegroundPolling(): void {
		if (this.foregroundTimer) return;
		this.foregroundTimer = setInterval(
			() => this.pollForeground(),
			FOREGROUND_POLL_MS,
		);
	}

	private stopForegroundPolling(): void {
		if (this.foregroundTimer) clearInterval(this.foregroundTimer);
		this.foregroundTimer = null;
	}

	private pollForeground(): void {
		let changed = false;
		let alive = 0;
		for (const entry of this.entries.values()) {
			if (!isAlive(entry)) continue;
			alive += 1;
			const status = foregroundStatus(entry);
			if (status === entry.info.status) continue;
			entry.info = { ...entry.info, status };
			if (entry.lastLine.setForegroundRunning(status === "running")) {
				this.syncLastLine(entry);
			}
			changed = true;
		}
		if (alive === 0) this.stopForegroundPolling();
		if (changed) this.emitChanged();
	}

	private scheduleChanged(): void {
		if (this.changedTimer) return;
		this.changedTimer = setTimeout(
			() => this.emitChanged(),
			CHANGED_THROTTLE_MS,
		);
	}

	private emitChanged(): void {
		if (this.changedTimer) clearTimeout(this.changedTimer);
		this.changedTimer = null;
		this.events.changed(this.list());
	}
}

function isAlive(entry: TerminalEntry): boolean {
	return entry.info.status !== "crashed";
}

function foregroundStatus(entry: TerminalEntry): "idle" | "running" {
	try {
		const name = basename(entry.pty.process).replace(/^-/, "");
		return name === entry.shellName ? "idle" : "running";
	} catch {
		return entry.info.status === "running" ? "running" : "idle";
	}
}
