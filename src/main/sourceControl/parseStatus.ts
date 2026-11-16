import type { ScmFileStatus } from "../../shared/schemas/source_control";

export interface WorktreeEntry {
	path: string;
	head: string | null;
	branch: string | null;
	isMain: boolean;
}

export interface StatusEntry {
	path: string;
	raw: Buffer | null;
	status: ScmFileStatus;
	staged: boolean;
	baseOid: string | null;
	targetOid: string | null;
	baseMode: string | null;
	targetMode: string | null;
	submodule: boolean;
}

export interface StatusHeader {
	branch: string | null;
	head: string | null;
	unborn: boolean;
}

export interface StatusParser {
	feed: (record: Buffer) => void;
	header: StatusHeader;
}

const BRANCH_REF_PREFIX = "refs/heads/";
const SHORT_SHA_LENGTH = 7;
const SPACE = 0x20;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const lossyUtf8 = new TextDecoder("utf-8");

export function shortSha(sha: string): string | null {
	return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | null = null;
	let skip = false;
	let blocks = 0;

	const flush = (): void => {
		if (current && !skip) entries.push(current);
		current = null;
		skip = false;
	};

	for (const token of stdout.split("\0")) {
		if (token === "") {
			flush();
			continue;
		}
		const space = token.indexOf(" ");
		const key = space === -1 ? token : token.slice(0, space);
		const value = space === -1 ? "" : token.slice(space + 1);
		if (key === "worktree") {
			flush();
			current = { path: value, head: null, branch: null, isMain: blocks === 0 };
			blocks++;
			continue;
		}
		if (!current) continue;
		if (key === "HEAD") {
			current.head = shortSha(value);
		} else if (key === "branch") {
			current.branch = value.startsWith(BRANCH_REF_PREFIX)
				? value.slice(BRANCH_REF_PREFIX.length)
				: value;
		} else if (key === "bare" || key === "prunable") {
			skip = true;
		}
	}
	flush();
	return entries;
}

export function decodeBytes(bytes: Uint8Array): { text: string; lossy: boolean } {
	try {
		return { text: strictUtf8.decode(bytes), lossy: false };
	} catch {
		return { text: lossyUtf8.decode(bytes), lossy: true };
	}
}

function pathStart(record: Buffer, spaces: number): number {
	let index = -1;
	for (let n = 0; n < spaces; n++) {
		index = record.indexOf(SPACE, index + 1);
		if (index === -1) return -1;
	}
	return index + 1;
}

function headFields(record: Buffer, start: number): string[] {
	return record.toString("latin1", 0, start - 1).split(" ");
}

function oidOrNull(value: string | undefined): string | null {
	if (!value || /^0+$/.test(value)) return null;
	return /^[0-9a-f]{40,64}$/i.test(value) ? value : null;
}

function modeOrNull(value: string | undefined): string | null {
	if (!value || /^0+$/.test(value)) return null;
	return value;
}

function changeStatus(code: string): ScmFileStatus {
	if (code === "D") return "D";
	if (code === "A") return "A";
	if (code === "R") return "R";
	return "M";
}

function pathOf(record: Buffer, start: number): { path: string; raw: Buffer | null } | null {
	if (start <= 0 || start >= record.length) return null;
	const bytes = record.subarray(start);
	const { text, lossy } = decodeBytes(bytes);
	return { path: text, raw: lossy ? Buffer.from(bytes) : null };
}

export function createStatusParser(
	onEntry: (entry: StatusEntry) => void,
	onRecord: () => void = () => {},
	skipUntracked: (path: string) => boolean = () => false,
): StatusParser {
	const header: StatusHeader = { branch: null, head: null, unborn: false };
	let skipNext = false;

	const feed = (record: Buffer): void => {
		if (skipNext) {
			skipNext = false;
			return;
		}
		if (record.length < 2) return;
		const kind = record[0];

		if (kind === 0x23) {
			const line = record.toString("utf8");
			if (line.startsWith("# branch.oid ")) {
				const oid = line.slice("# branch.oid ".length);
				header.unborn = oid === "(initial)";
				header.head = shortSha(oid);
			} else if (line.startsWith("# branch.head ")) {
				const name = line.slice("# branch.head ".length);
				header.branch = name === "(detached)" ? null : name;
			}
			return;
		}

		if (kind === 0x3f) {
			const found = pathOf(record, 2);
			if (!found || skipUntracked(found.path)) return;
			onRecord();
			onEntry({
				...found,
				status: "U",
				staged: false,
				baseOid: null,
				targetOid: null,
				baseMode: null,
				targetMode: null,
				submodule: false,
			});
			return;
		}

		if (kind === 0x75) {
			const start = pathStart(record, 10);
			const found = pathOf(record, start);
			if (!found) return;
			const f = headFields(record, start);
			onRecord();
			onEntry({
				...found,
				status: "C",
				staged: false,
				baseOid: oidOrNull(f[8]),
				targetOid: null,
				baseMode: modeOrNull(f[4]),
				targetMode: modeOrNull(f[6]),
				submodule: f[2]?.startsWith("S") ?? false,
			});
			return;
		}

		if (kind === 0x31 || kind === 0x32) {
			const renamed = kind === 0x32;
			if (renamed) skipNext = true;
			const start = pathStart(record, renamed ? 9 : 8);
			const found = pathOf(record, start);
			if (!found) return;
			const f = headFields(record, start);
			const xy = f[1] ?? "..";
			const submodule = f[2]?.startsWith("S") ?? false;
			const x = xy[0] ?? ".";
			const y = xy[1] ?? ".";
			if (x === "." && y === ".") return;
			onRecord();
			if (x !== ".") {
				onEntry({
					...found,
					status: changeStatus(x),
					staged: true,
					baseOid: x === "A" ? null : oidOrNull(f[6]),
					targetOid: x === "D" ? null : oidOrNull(f[7]),
					baseMode: modeOrNull(f[3]),
					targetMode: modeOrNull(f[4]),
					submodule,
				});
			}
			if (y !== ".") {
				onEntry({
					raw: found.raw ? Buffer.from(found.raw) : null,
					path: found.path,
					status: y === "D" ? "D" : "M",
					staged: false,
					baseOid: oidOrNull(f[7]),
					targetOid: null,
					baseMode: modeOrNull(f[4]),
					targetMode: modeOrNull(f[5]),
					submodule,
				});
			}
		}
	};

	return { feed, header };
}
