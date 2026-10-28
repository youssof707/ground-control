import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { describeError, logActivity } from "../activityLog";

const execFileAsync = promisify(execFile);

const SUDO = "/usr/bin/sudo";
const PMSET = "/usr/bin/pmset";
const OSASCRIPT = "/usr/bin/osascript";
const SUDOERS_PATH = "/etc/sudoers.d/ground-control";

type AuthState = "unknown" | "ok" | "declined";

let auth: AuthState = "unknown";
let authInFlight: Promise<boolean> | null = null;
const refs = new Map<string, number>();

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

async function pmsetSchedule(args: string[]): Promise<void> {
	const command = `pmset schedule ${args.join(" ")}`;
	try {
		await execFileAsync(SUDO, ["-n", PMSET, "schedule", ...args]);
		logActivity("pmset", `${command}: ok`);
	} catch (err) {
		logActivity("pmset", `${command}: failed (${describeError(err)})`);
	}
}

export async function scheduleWake(atMs: number): Promise<string | null> {
	if (atMs <= Date.now()) {
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
	if (await ensureAuthorized()) await pmsetSchedule(["wake", key]);
	else logActivity("pmset", `wake ${key} not scheduled: not authorized`);
	return key;
}

export async function cancelWake(key: string): Promise<void> {
	const count = refs.get(key) ?? 0;
	if (count <= 1) {
		refs.delete(key);
		if (count === 1 && auth === "ok") {
			await pmsetSchedule(["cancel", "wake", key]);
		} else if (count === 1) {
			logActivity("pmset", `wake ${key} released without pmset cancel: not authorized`);
		}
		return;
	}
	refs.set(key, count - 1);
	logActivity("pmset", `wake ${key} still needed, refs=${count - 1}`);
}

export async function cancelAllWakes(): Promise<void> {
	const keys = [...refs.keys()];
	refs.clear();
	if (keys.length > 0) logActivity("pmset", `cancelling all ${keys.length} scheduled wakes`);
	if (auth !== "ok") return;
	await Promise.all(keys.map((key) => pmsetSchedule(["cancel", "wake", key])));
}
