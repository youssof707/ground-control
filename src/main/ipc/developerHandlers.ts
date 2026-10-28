import { ipcMain, powerMonitor, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type {
	ActivityLogSnapshot,
	CaffeinateProcess,
} from "../../shared/activityLog";
import {
	activityLogPath,
	clearActivityLog,
	logActivity,
	readActivityLog,
} from "../activityLog";
import { readPmsetSchedule } from "../sessions/wakeScheduler";
import type { KeepAwake } from "../sessions/KeepAwake";

const execFileAsync = promisify(execFile);
const PS = "/bin/ps";
const PS_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

async function listCaffeinateProcesses(
	keepAwake: KeepAwake,
	sessionTitle: (runtimeId: string) => string | undefined,
): Promise<CaffeinateProcess[]> {
	if (process.platform !== "darwin") return [];
	let stdout: string;
	try {
		({ stdout } = await execFileAsync(PS, ["-Ao", "pid=,ppid=,lstart=,args="], {
			env: { ...process.env, LC_ALL: "C" },
			maxBuffer: 8 * 1024 * 1024,
		}));
	} catch {
		return [];
	}
	const status = keepAwake.status();
	const out: CaffeinateProcess[] = [];
	for (const line of stdout.split("\n")) {
		const m = PS_LINE_RE.exec(line);
		if (!m) continue;
		const [, pidText, ppidText, lstart, args] = m;
		const binary = args.split(/\s+/, 1)[0];
		if (binary !== "caffeinate" && !binary.endsWith("/caffeinate")) continue;
		const pid = Number(pidText);
		const ours = Number(ppidText) === process.pid || status?.pid === pid;
		const started = Date.parse(lstart);
		out.push({
			pid,
			startedAt: Number.isNaN(started) ? null : started,
			args,
			ours,
			sessions:
				ours && status?.pid === pid
					? status.runtimeIds.map((id) => sessionTitle(id) || id)
					: [],
		});
	}
	return out.sort((a, b) => Number(b.ours) - Number(a.ours) || (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

function logPowerEvents(): void {
	powerMonitor.on("suspend", () => logActivity("power", "system going to sleep"));
	powerMonitor.on("resume", () => logActivity("power", "system woke up"));
	powerMonitor.on("lock-screen", () => logActivity("power", "screen locked"));
	powerMonitor.on("unlock-screen", () => logActivity("power", "screen unlocked"));
	powerMonitor.on("on-ac", () => logActivity("power", "switched to AC power"));
	powerMonitor.on("on-battery", () => logActivity("power", "switched to battery power"));
}

export function registerDeveloperHandlers(
	keepAwake: KeepAwake,
	sessionTitle: (runtimeId: string) => string | undefined,
): void {
	logPowerEvents();

	ipcMain.handle(
		"activityLog:read",
		async (): Promise<ActivityLogSnapshot> => ({
			path: activityLogPath(),
			entries: await readActivityLog(),
		}),
	);

	ipcMain.handle("activityLog:clear", () => clearActivityLog());

	ipcMain.handle("activityLog:reveal", () => {
		const path = activityLogPath();
		if (existsSync(path)) shell.showItemInFolder(path);
		else void shell.openPath(dirname(path));
	});

	ipcMain.handle("activityLog:pmsetSched", () => readPmsetSchedule());

	ipcMain.handle("activityLog:caffeinate", () =>
		listCaffeinateProcesses(keepAwake, sessionTitle),
	);
}
