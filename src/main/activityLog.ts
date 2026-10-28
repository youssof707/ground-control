import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	ACTIVITY_SOURCES,
	type ActivityEntry,
	type ActivitySource,
} from "../shared/activityLog";
import { broadcast } from "./windows";

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_READ_LIMIT = 2000;

let queue: Promise<void> = Promise.resolve();

export function activityLogPath(): string {
	return join(app.getPath("logs"), is.dev ? "activity-dev.log" : "activity.log");
}

function rotatedPath(): string {
	return `${activityLogPath()}.1`;
}

function pad(n: number, width = 2): string {
	return String(Math.trunc(Math.abs(n))).padStart(width, "0");
}

function localIso(ms: number): string {
	const d = new Date(ms);
	const offset = -d.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
		`${sign}${pad(offset / 60)}:${pad(offset % 60)}`
	);
}

function singleLine(message: string): string {
	return message.replace(/\s*[\r\n]+\s*/g, " ⏎ ");
}

export function describeError(err: unknown): string {
	if (err instanceof Error) {
		const stderr = (err as { stderr?: unknown }).stderr;
		const extra = typeof stderr === "string" && stderr.trim() ? ` (${stderr.trim()})` : "";
		return `${err.message}${extra}`;
	}
	return String(err);
}

async function rotateIfNeeded(path: string): Promise<void> {
	try {
		if ((await stat(path)).size < MAX_BYTES) return;
	} catch {
		return;
	}
	await rename(path, rotatedPath());
}

async function append(line: string): Promise<void> {
	const path = activityLogPath();
	await mkdir(dirname(path), { recursive: true });
	await rotateIfNeeded(path);
	await appendFile(path, line, "utf8");
}

export function logActivity(source: ActivitySource, message: string): void {
	const entry: ActivityEntry = { at: Date.now(), source, message: singleLine(message) };
	console.log(`[${source}] ${entry.message}`);
	const line = `${localIso(entry.at)}\t${source}\t${entry.message}\n`;
	queue = queue
		.then(() => append(line))
		.catch((err) => console.error("[activity-log] write failed:", err));
	broadcast("activityLog:appended", entry);
}

function parseLine(line: string): ActivityEntry | null {
	const first = line.indexOf("\t");
	const second = line.indexOf("\t", first + 1);
	if (first < 0 || second < 0) return null;
	const at = Date.parse(line.slice(0, first));
	const source = line.slice(first + 1, second) as ActivitySource;
	if (Number.isNaN(at) || !ACTIVITY_SOURCES.includes(source)) return null;
	return { at, source, message: line.slice(second + 1) };
}

async function readLines(path: string): Promise<string[]> {
	try {
		return (await readFile(path, "utf8")).split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

export async function readActivityLog(
	limit = DEFAULT_READ_LIMIT,
): Promise<ActivityEntry[]> {
	await queue;
	let lines = await readLines(activityLogPath());
	if (lines.length < limit) lines = [...(await readLines(rotatedPath())), ...lines];
	return lines
		.slice(-limit)
		.map(parseLine)
		.filter((e): e is ActivityEntry => e !== null);
}

export async function clearActivityLog(): Promise<void> {
	const run = queue.then(async () => {
		await mkdir(dirname(activityLogPath()), { recursive: true });
		await writeFile(activityLogPath(), "", "utf8");
		await writeFile(rotatedPath(), "", "utf8");
	});
	queue = run.catch((err) => console.error("[activity-log] clear failed:", err));
	await run;
}
