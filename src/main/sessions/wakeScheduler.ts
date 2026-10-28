import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

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
		return true;
	} catch {
		return false;
	}
}

async function installSudoersRule(): Promise<boolean> {
	const line = sudoersLine();
	if (!line) return false;
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
		return true;
	} catch (err) {
		console.error("[auto-resume] sudoers install declined or failed:", err);
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
		console.log(`[auto-resume] pmset wake scheduling ${ok ? "authorized" : "unavailable"}`);
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
	try {
		await execFileAsync(SUDO, ["-n", PMSET, "schedule", ...args]);
		console.log(`[auto-resume] pmset schedule ${args.join(" ")}`);
	} catch (err) {
		console.error(`[auto-resume] pmset schedule ${args.join(" ")} failed:`, err);
	}
}

export async function scheduleWake(atMs: number): Promise<string | null> {
	if (atMs <= Date.now()) return null;
	const key = formatPmsetDate(atMs);
	const count = refs.get(key) ?? 0;
	refs.set(key, count + 1);
	if (count === 0 && (await ensureAuthorized())) {
		await pmsetSchedule(["wake", key]);
	}
	return key;
}

export async function cancelWake(key: string): Promise<void> {
	const count = refs.get(key) ?? 0;
	if (count <= 1) {
		refs.delete(key);
		if (count === 1 && auth === "ok") {
			await pmsetSchedule(["cancel", "wake", key]);
		}
		return;
	}
	refs.set(key, count - 1);
}

export async function cancelAllWakes(): Promise<void> {
	const keys = [...refs.keys()];
	refs.clear();
	if (auth !== "ok") return;
	await Promise.all(keys.map((key) => pmsetSchedule(["cancel", "wake", key])));
}
