import type { ScmFile, ScmFileStatus } from "../../shared/schemas/source_control";

export interface WorktreeEntry {
	path: string;
	head: string | null;
	branch: string | null;
}

export interface ParsedStatus {
	branch: string | null;
	head: string | null;
	merge: ScmFile[];
	staged: ScmFile[];
	changes: ScmFile[];
}

const BRANCH_REF_PREFIX = "refs/heads/";
const SHORT_SHA_LENGTH = 7;

function shortSha(sha: string): string | null {
	return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | null = null;
	let skip = false;

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
			current = { path: value, head: null, branch: null };
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

function fieldAfter(record: string, spaces: number): string | null {
	let index = -1;
	for (let n = 0; n < spaces; n++) {
		index = record.indexOf(" ", index + 1);
		if (index === -1) return null;
	}
	return record.slice(index + 1);
}

function stagedStatus(code: string): ScmFileStatus | null {
	switch (code) {
		case "M":
		case "T":
			return "M";
		case "A":
		case "C":
			return "A";
		case "D":
			return "D";
		case "R":
			return "R";
		default:
			return null;
	}
}

function unstagedStatus(code: string): ScmFileStatus | null {
	switch (code) {
		case "M":
		case "T":
			return "M";
		case "A":
			return "A";
		case "D":
			return "D";
		case "R":
		case "C":
			return "R";
		default:
			return null;
	}
}

export function parseStatusV2(stdout: string): ParsedStatus {
	const result: ParsedStatus = {
		branch: null,
		head: null,
		merge: [],
		staged: [],
		changes: [],
	};
	const tokens = stdout.split("\0");

	for (let i = 0; i < tokens.length; i++) {
		const record = tokens[i];
		if (!record) continue;
		const kind = record[0];

		if (kind === "#") {
			if (record.startsWith("# branch.oid ")) {
				result.head = shortSha(record.slice("# branch.oid ".length));
			} else if (record.startsWith("# branch.head ")) {
				const name = record.slice("# branch.head ".length);
				result.branch = name === "(detached)" ? null : name;
			}
			continue;
		}

		if (kind === "?") {
			const path = record.slice(2);
			if (path) result.changes.push({ path, status: "U" });
			continue;
		}

		if (kind === "u") {
			const path = fieldAfter(record, 10);
			if (path) result.merge.push({ path, status: "C" });
			continue;
		}

		if (kind === "1" || kind === "2") {
			const path = fieldAfter(record, kind === "1" ? 8 : 9);
			if (kind === "2") i++;
			if (!path) continue;
			const staged = stagedStatus(record[2]);
			const unstaged = unstagedStatus(record[3]);
			if (staged) result.staged.push({ path, status: staged });
			if (unstaged) result.changes.push({ path, status: unstaged });
		}
	}

	return result;
}
