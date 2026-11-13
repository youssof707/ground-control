import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";
import xtermHeadless from "@xterm/headless";
import { spawn, type IPty } from "node-pty";
import {
	MAX_TERMINAL_GROUP_SIZE,
	type TerminalConfig,
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
const SCREEN_SCROLLBACK = 200;
const STARTUP_QUIET_MS = 300;
const STARTUP_MAX_WAIT_MS = 5000;

interface TerminalEntry {
	pty: IPty;
	shellName: string;
	info: TerminalInfo;
	buffer: string;
	seq: number;
	lastLine: LastLineTracker;
	screen: HeadlessTerminal;
	lastCommand: string;
	startup: { command: string; quiet: NodeJS.Timeout | null; deadline: NodeJS.Timeout } | null;
}

const { Terminal: HeadlessTerminal } = xtermHeadless;
type HeadlessTerminal = InstanceType<typeof HeadlessTerminal>;

export interface TerminalGroupConfig {
	name: string;
	cwd: string;
	commands: string[];
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
		if (
			splitFrom &&
			(group.length === 0 || group.length >= MAX_TERMINAL_GROUP_SIZE)
		) {
			return null;
		}
		const source = group[0]?.info;
		const cwd = await resolveCwd(source?.cwd ?? requestedCwd);
		const entry = this.spawnEntry(
			cwd,
			source?.groupId ?? randomUUID(),
			source?.name,
		);
		this.emitChanged();
		return entry.info;
	}

	describeGroup(groupId: string): TerminalGroupConfig | null {
		const group = this.groupEntries(groupId);
		const first = group[0];
		if (!first) return null;
		return {
			name: first.info.name ?? (basename(first.info.cwd) || "/"),
			cwd: first.info.cwd,
			commands: group.map((entry) => entry.lastCommand),
		};
	}

	async replaceGroup(
		groupId: string | null,
		config: TerminalConfig,
	): Promise<string> {
		const cwd = await resolveCwd(config.cwd);
		const targetId = groupId ?? randomUUID();
		for (const entry of this.groupEntries(targetId)) {
			this.entries.delete(entry.info.id);
			this.disposeEntry(entry);
		}
		const commands = config.commands.slice(0, MAX_TERMINAL_GROUP_SIZE);
		for (const command of commands.length > 0 ? commands : [""]) {
			const entry = this.spawnEntry(cwd, targetId, config.name);
			if (command.trim()) this.runAfterStartup(entry, command.trim());
		}
		this.emitChanged();
		return targetId;
	}

	private spawnEntry(
		cwd: string,
		groupId: string,
		name: string | undefined,
	): TerminalEntry {
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
				groupId,
				name,
				cwd,
				status: "idle",
				lastLine: "",
				lastLineAt: 0,
				createdAt: Date.now(),
			},
			buffer: "",
			seq: 0,
			lastLine: new LastLineTracker(),
			screen: new HeadlessTerminal({
				cols: DEFAULT_COLS,
				rows: DEFAULT_ROWS,
				scrollback: SCREEN_SCROLLBACK,
				allowProposedApi: true,
			}),
			lastCommand: "",
			startup: null,
		};
		this.entries.set(entry.info.id, entry);
		pty.onData((data) => this.handleData(entry, data));
		pty.onExit(({ exitCode, signal }) =>
			this.handleExit(entry, exitCode, signal),
		);
		this.ensureForegroundPolling();
		return entry;
	}

	private runAfterStartup(entry: TerminalEntry, command: string): void {
		const fire = () => this.flushStartup(entry);
		entry.startup = {
			command,
			quiet: null,
			deadline: setTimeout(fire, STARTUP_MAX_WAIT_MS),
		};
	}

	private bumpStartup(entry: TerminalEntry): void {
		const startup = entry.startup;
		if (!startup) return;
		if (startup.quiet) clearTimeout(startup.quiet);
		startup.quiet = setTimeout(
			() => this.flushStartup(entry),
			STARTUP_QUIET_MS,
		);
	}

	private flushStartup(entry: TerminalEntry): void {
		const startup = entry.startup;
		if (!startup) return;
		this.clearStartup(entry);
		this.write(entry.info.id, `${startup.command}\r`);
	}

	private clearStartup(entry: TerminalEntry): void {
		const startup = entry.startup;
		if (!startup) return;
		if (startup.quiet) clearTimeout(startup.quiet);
		clearTimeout(startup.deadline);
		entry.startup = null;
	}

	private recordCommand(entry: TerminalEntry, data: string): void {
		const enter = data.indexOf("\r");
		if (enter === -1 || entry.info.status !== "idle") return;
		const prompt = entry.lastLine.promptText;
		if (!prompt) return;
		const line = cursorLine(entry.screen);
		if (!line.startsWith(prompt)) return;
		const typed = Array.from(data.slice(0, enter))
			.filter((char) => char.charCodeAt(0) >= 32)
			.join("");
		const command = (line.slice(prompt.length) + typed).trim();
		if (command) entry.lastCommand = command;
	}

	snapshot(id: string): TerminalSnapshot | null {
		const entry = this.entries.get(id);
		return entry ? { data: entry.buffer, seq: entry.seq } : null;
	}

	write(id: string, data: string): void {
		const entry = this.entries.get(id);
		if (!entry || !isAlive(entry)) return;
		entry.lastLine.input(data);
		this.recordCommand(entry, data);
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
			this.disposeEntry(entry);
		}
		this.emitChanged();
	}

	private groupOf(id: string): TerminalEntry[] {
		const groupId = this.entries.get(id)?.info.groupId;
		return groupId ? this.groupEntries(groupId) : [];
	}

	private groupEntries(groupId: string): TerminalEntry[] {
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
			entry.screen.resize(cols, rows);
		} catch {
			return;
		}
	}

	kill(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		this.disposeEntry(entry);
		this.emitChanged();
	}

	disposeAll(): void {
		if (this.changedTimer) clearTimeout(this.changedTimer);
		this.changedTimer = null;
		this.stopForegroundPolling();
		for (const entry of this.entries.values()) this.disposeEntry(entry);
		this.entries.clear();
	}

	private disposeEntry(entry: TerminalEntry): void {
		this.clearStartup(entry);
		this.killPty(entry);
		entry.screen.dispose();
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
		entry.screen.write(data);
		this.bumpStartup(entry);
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
		this.clearStartup(entry);
		if (exitCode === 0 && !signal) {
			this.entries.delete(entry.info.id);
			entry.screen.dispose();
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

async function resolveCwd(requested: string | undefined): Promise<string> {
	return requested && (await directoryExists(requested)) ? requested : homedir();
}

function cursorLine(screen: HeadlessTerminal): string {
	const buffer = screen.buffer.active;
	const end = buffer.baseY + buffer.cursorY;
	let start = end;
	while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1;
	let text = "";
	for (let row = start; row <= end; row += 1) {
		text += buffer.getLine(row)?.translateToString(row === end) ?? "";
	}
	return text;
}
