import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { is } from "@electron-toolkit/utils";
import { describeError, logActivity } from "../activityLog";
import * as windows from "../windows";

const execFileAsync = promisify(execFile);

const SUDO = "/usr/bin/sudo";
const PMSET = "/usr/bin/pmset";
const OSASCRIPT = "/usr/bin/osascript";
const SUDOERS_PATH = "/etc/sudoers.d/ground-control";
const OWNER = "ground-control";
const PMSET_KEY_RE = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const SCHED_LINE_RE =
	/^\s*\[\d+\]\s+(\S+)\s+at\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\s+by\s+'([^']*)')?/;

type AuthState = "unknown" | "ok" | "declined";

let auth: AuthState = "unknown";
let authInFlight: Promise<boolean> | null = null;
const refs = new Map<string, number>();
let shuttingDown = false;
let lastWakeError: string | null = null;
let reconcileChain: Promise<void> = Promise.resolve();
const inFlight = new Set<Promise<string | null>>();

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatPmsetDate(atMs: number): string {
	const d = new Date(atMs);
	const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${pad2(d.getFullYear() % 100)}`;
	const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	return `${date} ${time}`;
}

function sudoersLine(): string | null {
	const user = userInfo().username;
	if (!/^[a-z_][a-z0-9_-]*$/i.test(user)) return null;
	return `${user} ALL=(root) NOPASSWD: ${PMSET} schedule wake *, ${PMSET} schedule cancel wake *, ${PMSET} -g sched`;
}

function appleScriptString(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function probe(): Promise<boolean> {
	try {
		await execFileAsync(SUDO, ["-n", PMSET, "-g", "sched"]);
		logActivity("pmset", "sudo -n pmset probe: authorized");
		return true;
	} catch (err) {
		logActivity("pmset", `sudo -n pmset probe: not authorized (${describeError(err)})`);
		return false;
	}
}

export async function readPmsetSchedule(): Promise<string | null> {
	if (process.platform !== "darwin") return null;
	try {
		const { stdout } = await execFileAsync(SUDO, ["-n", PMSET, "-g", "sched"]);
		return stdout;
	} catch {
		return null;
	}
}

async function installSudoersRule(): Promise<boolean> {
	const line = sudoersLine();
	if (!line) {
		logActivity("pmset", "sudoers install skipped: unsupported username");
		return false;
	}
	logActivity("pmset", "requesting admin approval to install sudoers rule");
	const script = [
		"f=$(/usr/bin/mktemp)",
		`/usr/bin/printf '%s\\n' '${line}' > "$f"`,
		'/usr/sbin/visudo -c -q -f "$f"',
		`/usr/bin/install -m 0440 -o root -g wheel "$f" ${SUDOERS_PATH}`,
	].join(" && ");
	const cleanup = 's=$?; /bin/rm -f "$f"; exit $s';
	try {
		await execFileAsync(OSASCRIPT, [
			"-e",
			`do shell script ${appleScriptString(`${script}; ${cleanup}`)} with administrator privileges`,
		]);
		logActivity("pmset", `sudoers rule installed at ${SUDOERS_PATH}`);
		return true;
	} catch (err) {
		logActivity("pmset", `sudoers install declined or failed: ${describeError(err)}`);
		return false;
	}
}

export function ensureAuthorized(): Promise<boolean> {
	if (process.platform !== "darwin") return Promise.resolve(false);
	if (auth === "ok") return Promise.resolve(true);
	if (auth === "declined") return Promise.resolve(false);
	if (authInFlight) return authInFlight;
	authInFlight = (async () => {
		let ok = await probe();
		if (!ok && (await installSudoersRule())) ok = await probe();
		auth = ok ? "ok" : "declined";
		logActivity("pmset", `wake scheduling ${ok ? "authorized" : "unavailable"}`);
		authInFlight = null;
		return ok;
	})();
	return authInFlight;
}

export function requestAuthorization(): Promise<boolean> {
	if (auth === "declined") auth = "unknown";
	return ensureAuthorized();
}

export function getLastWakeError(): string | null {
	return lastWakeError;
}

function setWakeError(error: string | null): void {
	if (lastWakeError === error) return;
	lastWakeError = error;
	windows.broadcast("wake:error", error);
}

async function pmsetSchedule(args: string[]): Promise<boolean> {
	const command = `pmset schedule ${args.join(" ")} ${OWNER}`;
	try {
		await execFileAsync(SUDO, ["-n", PMSET, "schedule", ...args, OWNER]);
		logActivity("pmset", `${command}: ok`);
		if (args[0] === "wake") setWakeError(null);
		return true;
	} catch (err) {
		const message = `${command}: failed (${describeError(err)})`;
		logActivity("pmset", message);
		setWakeError(message);
		return false;
	}
}

export function parsePmsetKey(key: string): number {
	const m = PMSET_KEY_RE.exec(key);
	if (!m) return Number.NaN;
	const [, month, day, year, h, min, s] = m;
	return new Date(2000 + +year, +month - 1, +day, +h, +min, +s).getTime();
}

export function parseOwnedWakes(output: string, owner = OWNER): Map<string, number> {
	const owned = new Map<string, number>();
	for (const line of output.split("\n")) {
		const m = SCHED_LINE_RE.exec(line);
		if (!m || m[1] !== "wake" || m[8] !== owner) continue;
		const [, , month, day, year, h, min, s] = m;
		const key = formatPmsetDate(new Date(+year, +month - 1, +day, +h, +min, +s).getTime());
		owned.set(key, (owned.get(key) ?? 0) + 1);
	}
	return owned;
}

export interface WakeDiff {
	cancel: string[];
	schedule: string[];
}

export function diffWakes(owned: Map<string, number>, wanted: Iterable<string>, now: number): WakeDiff {
	const want = new Set(wanted);
	const cancel: string[] = [];
	for (const [key, count] of owned) {
		const extra = count - (want.has(key) ? 1 : 0);
		for (let i = 0; i < extra; i++) cancel.push(key);
	}
	const schedule = [...want].filter((key) => !owned.has(key) && parsePmsetKey(key) > now);
	return { cancel, schedule };
}

function readOwnSchedule(): Promise<string | null> {
	return execFileAsync(PMSET, ["-g", "sched"]).then(
		({ stdout }) => stdout,
		(err) => {
			logActivity("pmset", `pmset -g sched failed: ${describeError(err)}`);
			return null;
		},
	);
}

export function reconcileWakes(wanted: () => Iterable<string>): Promise<void> {
	const run = reconcileChain.then(() => reconcileNow(wanted));
	reconcileChain = run.catch((err) => logActivity("pmset", `wake reconcile failed: ${describeError(err)}`));
	return run;
}

async function reconcileNow(wanted: () => Iterable<string>): Promise<void> {
	if (process.platform !== "darwin") return;
	if (is.dev) {
		logActivity("pmset", "dev build: wake reconcile skipped");
		return;
	}
	await Promise.all(inFlight);
	const output = await readOwnSchedule();
	if (output === null) return;
	const { cancel, schedule } = diffWakes(parseOwnedWakes(output), shuttingDown ? [] : wanted(), Date.now());
	if (cancel.length === 0 && schedule.length === 0) return;
	if (auth !== "ok" && (shuttingDown || !(await ensureAuthorized()))) {
		logActivity("pmset", `wake reconcile skipped: not authorized (${cancel.length} to cancel, ${schedule.length} to schedule)`);
		return;
	}
	logActivity("pmset", `reconciling wakes: cancelling ${cancel.length}, scheduling ${schedule.length}`);
	for (const key of cancel) await pmsetSchedule(["cancel", "wake", key]);
	for (const key of schedule) await pmsetSchedule(["wake", key]);
}

function dropRef(key: string): void {
	const count = refs.get(key) ?? 0;
	if (count <= 1) refs.delete(key);
	else refs.set(key, count - 1);
}

export function scheduleWake(atMs: number, now = Date.now()): Promise<string | null> {
	const run = scheduleWakeNow(atMs, now);
	inFlight.add(run);
	void run.finally(() => inFlight.delete(run));
	return run;
}

async function scheduleWakeNow(atMs: number, now: number): Promise<string | null> {
	if (shuttingDown) return null;
	if (atMs <= now) {
		logActivity("pmset", `wake for ${new Date(atMs).toISOString()} skipped: already in the past`);
		return null;
	}
	const key = formatPmsetDate(atMs);
	const count = refs.get(key) ?? 0;
	refs.set(key, count + 1);
	if (count > 0) {
		logActivity("pmset", `wake ${key} already scheduled, refs=${count + 1}`);
		return key;
	}
	if (is.dev) {
		logActivity("pmset", `dev build: wake ${key} tracked without pmset`);
		return key;
	}
	if (!(await ensureAuthorized())) {
		logActivity("pmset", `wake ${key} not scheduled: not authorized`);
		return key;
	}
	if (shuttingDown) return null;
	const ok = await pmsetSchedule(["wake", key]);
	if (shuttingDown) {
		if (ok) await pmsetSchedule(["cancel", "wake", key]);
		return null;
	}
	if (!ok) {
		dropRef(key);
		return null;
	}
	return key;
}

export async function cancelWake(key: string, now = Date.now()): Promise<void> {
	const count = refs.get(key) ?? 0;
	if (count > 1) {
		refs.set(key, count - 1);
		logActivity("pmset", `wake ${key} still needed, refs=${count - 1}`);
		return;
	}
	refs.delete(key);
	if (count === 0) return;
	if (parsePmsetKey(key) <= now) {
		logActivity("pmset", `wake ${key} released: already passed`);
		return;
	}
	if (is.dev) {
		logActivity("pmset", `dev build: wake ${key} released without pmset`);
		return;
	}
	if (auth !== "ok") {
		logActivity("pmset", `wake ${key} released without pmset cancel: not authorized`);
		return;
	}
	await pmsetSchedule(["cancel", "wake", key]);
}

export async function cancelAllWakes(): Promise<void> {
	shuttingDown = true;
	const count = refs.size;
	refs.clear();
	if (count > 0) logActivity("pmset", `cancelling all ${count} scheduled wakes`);
	await reconcileWakes(() => []);
}
