import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { serialize } from "node:v8";
import { SCM_LIST_CAP, SCM_ROWS_BATCH, type ScmReply } from "../src/shared/schemas/source_control";
import { readDiff } from "../src/main/sourceControl/content";
import { scanCheckout } from "../src/main/sourceControl/scan";
import { ScmServer } from "../src/main/sourceControl/scmServer";

function flag(name: string, fallback: number): number {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const tracked = flag("tracked", 200_000);
const modified = flag("modified", 20_000);
const untracked = flag("untracked", 30_000);
const big = flag("big", 4);
const keep = process.argv.includes("--keep");

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "bench",
	GIT_AUTHOR_EMAIL: "bench@example.com",
	GIT_COMMITTER_NAME: "bench",
	GIT_COMMITTER_EMAIL: "bench@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, env: ENV, stdio: "ignore", maxBuffer: 1 << 30 });
}

function fileAt(root: string, i: number, prefix: string): string {
	const dir = path.join(root, prefix, `d${Math.floor(i / 1000)}`, `e${Math.floor(i / 50) % 20}`);
	return path.join(dir, `file-${i}.ts`);
}

function write(file: string, content: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function ms(n: number): string {
	return `${n.toFixed(0)} ms`;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; maxLoopDelay: number }> {
	const histogram = monitorEventLoopDelay({ resolution: 5 });
	histogram.enable();
	const start = performance.now();
	const value = await fn();
	const elapsed = performance.now() - start;
	histogram.disable();
	return { value, ms: elapsed, maxLoopDelay: histogram.max / 1e6 };
}

async function main(): Promise<void> {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gc-scm-bench-")));
	console.log(`Building repo in ${root}: ${tracked} tracked, ${modified} modified, ${untracked} untracked, ${big} big files`);
	const build = performance.now();
	git(root, "init", "-q", "-b", "main");
	for (let i = 0; i < tracked; i++) write(fileAt(root, i, "src"), `export const v${i} = ${i};\n`);
	const bigText = Array.from({ length: 60_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
	for (let i = 0; i < big; i++) write(path.join(root, "big", `big-${i}.txt`), bigText);
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", "base");
	for (let i = 0; i < modified; i++) {
		write(fileAt(root, (i * 7) % tracked, "src"), `export const v = ${i};\n`);
	}
	for (let i = 0; i < untracked; i++) write(fileAt(root, i, "new"), `new ${i}\n`);
	for (let i = 0; i < big; i++) {
		write(path.join(root, "big", `big-${i}.txt`), bigText.replace("line 30000", "line 30000 changed"));
	}
	console.log(`Repo ready in ${ms(performance.now() - build)}\n`);

	const cold = await timed(() => scanCheckout(root, { cap: SCM_LIST_CAP }));
	if (!cold.value.ok) throw new Error(`scan failed: ${cold.value.reason}`);
	const warm = await timed(() => scanCheckout(root, { cap: SCM_LIST_CAP }));
	if (!warm.value.ok) throw new Error("warm scan failed");
	console.log(`Changed paths:          ${warm.value.changed.toLocaleString()} (listed ${warm.value.entries.length.toLocaleString()})`);
	console.log(`Scan, first run:        ${ms(cold.ms)}  (max event-loop stall ${ms(cold.maxLoopDelay)})`);
	console.log(`Scan, second run:       ${ms(warm.ms)}  (max event-loop stall ${ms(warm.maxLoopDelay)})`);

	const replies: ScmReply[] = [];
	const server = new ScmServer({ scan: scanCheckout, diff: readDiff, cap: SCM_LIST_CAP });
	const conn = server.connect((r) => replies.push(r));
	const waitFor = async (id: number): Promise<ScmReply> => {
		for (;;) {
			const found = replies.find((r) => r.id === id);
			if (found) return found;
			await new Promise((r) => setTimeout(r, 1));
		}
	};

	conn.handle({ t: "scan", id: 1, checkout: root });
	const scanReply = await waitFor(1);
	if (scanReply.t !== "scan" || !scanReply.ok) throw new Error("server scan failed");
	const summaryBytes = serialize(scanReply).length;

	let largestRows = 0;
	let id = 2;
	const rowsStart = performance.now();
	for (let offset = 0; offset < scanReply.summary.listed; offset += SCM_ROWS_BATCH) {
		conn.handle({ t: "rows", id, checkout: root, scanId: scanReply.summary.scanId, offset, limit: SCM_ROWS_BATCH });
		largestRows = Math.max(largestRows, serialize(await waitFor(id)).length);
		id++;
	}
	const rowsMs = performance.now() - rowsStart;

	const bigEntry = warm.value.entries.find((e) => e.path.startsWith("big/"));
	let diffMs = 0;
	let diffBytes = 0;
	if (bigEntry) {
		const index = warm.value.entries.indexOf(bigEntry);
		const diffStart = performance.now();
		conn.handle({ t: "diff", id, checkout: root, scanId: scanReply.summary.scanId, index, path: bigEntry.path, force: true });
		diffBytes = serialize(await waitFor(id)).length;
		diffMs = performance.now() - diffStart;
		id++;
	}

	conn.handle({ t: "scan", id, checkout: root });
	await new Promise((r) => setTimeout(r, 50));
	const cancelStart = performance.now();
	conn.handle({ t: "cancel", id });
	conn.handle({ t: "scan", id: id + 1, checkout: root });
	await waitFor(id + 1);
	const cancelThenScan = performance.now() - cancelStart;

	console.log(`Summary message:        ${summaryBytes.toLocaleString()} bytes`);
	console.log(`Largest rows message:   ${largestRows.toLocaleString()} bytes (${Math.ceil(scanReply.summary.listed / SCM_ROWS_BATCH)} batches, ${ms(rowsMs)} total)`);
	console.log(`Big-file diff:          ${diffBytes.toLocaleString()} bytes in ${ms(diffMs)}`);
	console.log(`Cancel + fresh scan:    ${ms(cancelThenScan)}`);
	console.log(`Peak RSS:               ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);

	if (keep) console.log(`\nKept ${root}`);
	else fs.rmSync(root, { recursive: true, force: true });
}

void main().catch((err) => {
	console.error(err);
	process.exit(1);
});
