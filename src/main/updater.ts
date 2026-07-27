import { app, net } from "electron";
import { is } from "@electron-toolkit/utils";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { broadcast } from "./windows";

/**
 * Simple GitHub-Releases-based updater for the unsigned macOS build.
 *
 * Why we roll our own instead of electron-updater:
 *   - The app is unsigned (`identity: null` in electron-builder.yml). Squirrel.Mac
 *     refuses to swap in an update whose signature can't be validated, so the
 *     built-in autoUpdater path is a non-starter here.
 *   - We only ship one artifact (arm64 .dmg) and only need to handle three
 *     users. So a small "download the dmg the release workflow published,
 *     mount it, cp -R the new bundle over the old, relaunch" script is
 *     plenty.
 *
 * Quarantine trick: files downloaded via Electron's `net` module (i.e. NOT via
 * a browser or a shell that goes through LaunchServices) do not receive the
 * `com.apple.quarantine` xattr. So the user's manual `xattr -dr com.apple.quarantine`
 * step goes away entirely — we just download, mount, copy.
 */

const GH_OWNER = "youssof707";
const GH_REPO = "ground-control";
const RELEASES_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

export interface UpdateCheckResult {
	available: boolean;
	currentVersion: string;
	latestVersion: string | null;
	downloadUrl: string | null;
	releaseUrl: string | null;
	releaseNotes: string | null;
	error?: string;
}

interface GhRelease {
	tag_name: string;
	name: string;
	html_url: string;
	body: string;
	assets: { name: string; browser_download_url: string; size: number }[];
}

/**
 * Numeric-only semver compare. Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Handles the "v" prefix on tag names. Doesn't handle pre-release suffixes —
 * we don't ship any.
 */
function compareVersions(a: string, b: string): number {
	const parse = (s: string): number[] =>
		s.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
	const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
	const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
	if (a1 !== b1) return a1 - b1;
	if (a2 !== b2) return a2 - b2;
	return a3 - b3;
}

/**
 * Hit the GitHub Releases API and figure out whether the tag on the latest
 * release is newer than what we're running. Public repos need no auth; if the
 * repo goes private we'd have to add a token here.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const currentVersion = app.getVersion();
	// In dev, `app.getVersion()` reads from the working-tree package.json,
	// which lags the latest release tag between bumps. Every startup would
	// pop the "update available" modal even though the dev copy is fresher
	// than the last release. Short-circuit to a fake up-to-date result so
	// the flow is inert in `npm run dev` — the code path is still exercised
	// in real production builds.
	if (is.dev) {
		return {
			available: false,
			currentVersion,
			latestVersion: currentVersion,
			downloadUrl: null,
			releaseUrl: null,
			releaseNotes: null,
		};
	}
	try {
		const res = await net.fetch(RELEASES_API, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!res.ok) {
			return {
				available: false,
				currentVersion,
				latestVersion: null,
				downloadUrl: null,
				releaseUrl: null,
				releaseNotes: null,
				error: `GitHub API returned ${res.status}`,
			};
		}
		const release = (await res.json()) as GhRelease;
		const latestVersion = release.tag_name.replace(/^v/, "");
		const dmg = release.assets.find((a) => a.name.endsWith("-arm64.dmg"));
		const available = compareVersions(latestVersion, currentVersion) > 0;
		return {
			available,
			currentVersion,
			latestVersion,
			downloadUrl: dmg?.browser_download_url ?? null,
			releaseUrl: release.html_url,
			releaseNotes: release.body ?? null,
		};
	} catch (err) {
		return {
			available: false,
			currentVersion,
			latestVersion: null,
			downloadUrl: null,
			releaseUrl: null,
			releaseNotes: null,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Stream the DMG to a temp file, broadcasting progress percentages to the
 * renderer as we go. We use Electron's `net.request` (not `fetch`) because we
 * want the ClientResponse's raw byte stream to pipe through — `fetch` returns
 * a WHATWG stream which is more of a pain to consume in Node.
 */
async function downloadDmg(url: string, dest: string): Promise<void> {
	// Follow redirects — GitHub asset URLs 302 to S3. `net.request` follows by
	// default but we still need to read `content-length` from the final hop.
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const req = net.request({ url, method: "GET", redirect: "follow" });
		req.on("response", (res) => {
			if (res.statusCode < 200 || res.statusCode >= 300) {
				rejectPromise(new Error(`Download failed: HTTP ${res.statusCode}`));
				return;
			}
			const total = parseInt(
				String(res.headers["content-length"] ?? "0"),
				10,
			);
			let received = 0;
			let lastPct = -1;
			const out = createWriteStream(dest);
			res.on("data", (chunk: Buffer) => {
				received += chunk.length;
				out.write(chunk);
				if (total > 0) {
					const pct = Math.floor((received / total) * 100);
					// Rate-limit progress broadcasts to 1% granularity — the UI
					// doesn't need pixel-perfect updates and this cuts IPC by ~99×.
					if (pct !== lastPct) {
						lastPct = pct;
						broadcast("updater:progress", { received, total, percent: pct });
					}
				}
			});
			res.on("end", () => {
				out.end();
				out.on("finish", () => resolvePromise());
				out.on("error", rejectPromise);
			});
			res.on("error", rejectPromise);
		});
		req.on("error", rejectPromise);
		req.end();
	});
}

/**
 * `hdiutil attach -nobrowse -readonly` prints machine-readable output on the
 * last line: <device>\t<content-hint>\t<mountpoint>. We parse out the
 * mountpoint (a /Volumes/... path).
 */
async function mountDmg(dmgPath: string): Promise<string> {
	return new Promise<string>((resolvePromise, rejectPromise) => {
		const proc = spawn("hdiutil", [
			"attach",
			"-nobrowse",
			"-readonly",
			"-noverify",
			"-noautoopen",
			dmgPath,
		]);
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
		proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
		proc.on("close", (code) => {
			if (code !== 0) {
				rejectPromise(new Error(`hdiutil attach failed: ${stderr || stdout}`));
				return;
			}
			// Last non-empty tab-delimited line whose 3rd column starts with
			// /Volumes/ — that's the mountpoint we care about. Earlier lines
			// describe hidden partitions we don't need.
			const line = stdout
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean)
				.reverse()
				.find((l) => l.includes("/Volumes/"));
			if (!line) {
				rejectPromise(new Error(`Could not find mountpoint in: ${stdout}`));
				return;
			}
			const parts = line.split("\t").map((p) => p.trim());
			const mount = parts[parts.length - 1];
			if (!mount || !mount.startsWith("/Volumes/")) {
				rejectPromise(new Error(`Bad mountpoint parse: ${line}`));
				return;
			}
			resolvePromise(mount);
		});
	});
}

/**
 * Given a mountpoint like `/Volumes/Ground Control 1.13.0`, return the
 * absolute path of the .app bundle inside (there's typically exactly one).
 */
async function findAppInMount(mountpoint: string): Promise<string> {
	const entries = await fs.readdir(mountpoint);
	const appName = entries.find((n) => n.endsWith(".app"));
	if (!appName) throw new Error(`No .app found in ${mountpoint}`);
	return join(mountpoint, appName);
}

/**
 * We can't overwrite our own .app bundle while running. Standard macOS
 * hot-swap trick: write a shell script to /tmp that (1) waits for our PID to
 * exit, (2) rms the old app, (3) copies the new one over, (4) detaches the
 * DMG, (5) relaunches. Spawn it detached, then `app.quit()`.
 */
async function scheduleSwapAndRelaunch(
	mountpoint: string,
	newAppPath: string,
	installedAppPath: string,
	dmgPath: string,
): Promise<void> {
	const scriptPath = join(
		tmpdir(),
		`gc-updater-${Date.now()}-${process.pid}.sh`,
	);
	const logPath = join(tmpdir(), `gc-updater-${Date.now()}-${process.pid}.log`);
	// Shell-safe path quoting. Single-quote everything and escape any embedded
	// single quotes by closing/reopening the quoted string.
	const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
	const script = `#!/usr/bin/env bash
set -u
exec >>${sq(logPath)} 2>&1
echo "[updater] starting swap at $(date)"
PARENT_PID=${process.pid}
# Wait up to 30s for the parent app to exit.
for i in $(seq 1 60); do
  if ! kill -0 "$PARENT_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
echo "[updater] parent exited, swapping app"
rm -rf ${sq(installedAppPath)}
cp -R ${sq(newAppPath)} ${sq(installedAppPath)}
echo "[updater] copy done, detaching dmg"
hdiutil detach ${sq(mountpoint)} -quiet -force || true
rm -f ${sq(dmgPath)}
rm -f ${sq(scriptPath)}
echo "[updater] relaunching"
open -n ${sq(installedAppPath)}
`;
	await fs.writeFile(scriptPath, script, { mode: 0o755 });
	// Spawn detached so the script survives the parent quitting.
	const child = spawn("/bin/bash", [scriptPath], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

/**
 * The full install flow: download → mount → locate app → schedule swap →
 * quit. Broadcasts status updates so the renderer can show progress.
 */
export async function downloadAndInstall(downloadUrl: string): Promise<void> {
	broadcast("updater:status", { phase: "downloading" });
	const dmgName = basename(new URL(downloadUrl).pathname);
	const dmgPath = join(tmpdir(), dmgName);
	await downloadDmg(downloadUrl, dmgPath);

	broadcast("updater:status", { phase: "mounting" });
	const mountpoint = await mountDmg(dmgPath);
	const newAppPath = await findAppInMount(mountpoint);

	// Where's our currently-installed .app bundle? Walk up from the exe path:
	// /Applications/Ground Control.app/Contents/MacOS/Ground Control
	//   → dirname × 3 → the .app itself.
	const exe = app.getPath("exe");
	const installedAppPath = resolve(dirname(exe), "..", "..");

	broadcast("updater:status", { phase: "installing" });
	await scheduleSwapAndRelaunch(
		mountpoint,
		newAppPath,
		installedAppPath,
		dmgPath,
	);

	// Give the renderer a beat to render the "restarting" state before we
	// pull the rug out.
	setTimeout(() => {
		app.quit();
	}, 400);
}
