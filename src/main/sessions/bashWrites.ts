import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface BashCandidate {
	path: string;
	kind: "file" | "repo";
}

const MAX_CANDIDATES = 200;
const CLOCK_SLACK_MS = 50;
const OPERATORS = ["&&", "||", ">>", "&>", ";", "|", "&", ">", "<", "(", ")", "\n"];
const SEPARATORS = new Set(["&&", "||", ";", "|", "&", "(", ")", "\n"]);

type Token = { word: string } | { op: string };

export function tokenize(command: string): Token[] {
	const tokens: Token[] = [];
	let word = "";
	let inWord = false;
	const flush = () => {
		if (inWord) tokens.push({ word });
		word = "";
		inWord = false;
	};
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (ch === "'") {
			const end = command.indexOf("'", i + 1);
			const stop = end === -1 ? command.length : end;
			word += command.slice(i + 1, stop);
			inWord = true;
			i = stop + 1;
			continue;
		}
		if (ch === '"') {
			i++;
			inWord = true;
			while (i < command.length && command[i] !== '"') {
				if (command[i] === "\\" && i + 1 < command.length) i++;
				word += command[i];
				i++;
			}
			i++;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			if (command[i + 1] !== "\n") {
				word += command[i + 1];
				inWord = true;
			}
			i += 2;
			continue;
		}
		if (ch === " " || ch === "\t") {
			flush();
			i++;
			continue;
		}
		const op = OPERATORS.find((candidate) => command.startsWith(candidate, i));
		if (op) {
			flush();
			tokens.push({ op });
			i += op.length;
			continue;
		}
		word += ch;
		inWord = true;
		i++;
	}
	flush();
	return tokens;
}

function expand(word: string, dir: string): string {
	if (word === "~") return homedir();
	if (word.startsWith("~/")) return join(homedir(), word.slice(2));
	return isAbsolute(word) ? word : resolve(dir, word);
}

export function bashCandidates(command: string, cwd: string): BashCandidate[] {
	const out: BashCandidate[] = [];
	let dir = cwd;
	let commandStart = true;
	let pendingCd = false;
	let pendingRepo = false;
	for (const token of tokenize(command)) {
		if (out.length >= MAX_CANDIDATES) break;
		if ("op" in token) {
			if (SEPARATORS.has(token.op)) commandStart = true;
			pendingCd = false;
			pendingRepo = false;
			continue;
		}
		const word = token.word;
		if (commandStart) {
			commandStart = false;
			pendingCd = word === "cd" || word === "pushd";
			continue;
		}
		if (word.includes("$") || word.includes("`") || word.includes("\0")) continue;
		if (pendingCd) {
			pendingCd = false;
			if (word.startsWith("-")) continue;
			dir = expand(word, dir);
			out.push({ path: dir, kind: "repo" });
			continue;
		}
		if (pendingRepo) {
			pendingRepo = false;
			out.push({ path: expand(word, dir), kind: "repo" });
			continue;
		}
		if (word === "-C" || word === "--git-dir" || word === "--work-tree") {
			pendingRepo = true;
			continue;
		}
		if (word.startsWith("-") || !word) continue;
		out.push({ path: expand(word, dir), kind: "file" });
	}
	return out;
}

async function modifiedSince(path: string, since: number): Promise<boolean> {
	try {
		return (await fs.stat(path)).mtimeMs >= since - CLOCK_SLACK_MS;
	} catch {
		return false;
	}
}

async function gitDirOf(dir: string): Promise<string | null> {
	let current = dir;
	while (true) {
		const dotGit = join(current, ".git");
		try {
			const stat = await fs.stat(dotGit);
			if (stat.isDirectory()) return dotGit;
			const text = await fs.readFile(dotGit, "utf8");
			const match = /^gitdir:\s*(.+)$/m.exec(text);
			return match ? resolve(current, match[1].trim()) : null;
		} catch {
			const parent = dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}
}

async function written(candidate: BashCandidate, since: number): Promise<boolean> {
	if (candidate.kind === "file") {
		return (await modifiedSince(candidate.path, since)) || (await modifiedSince(dirname(candidate.path), since));
	}
	const gitDir = await gitDirOf(candidate.path);
	if (!gitDir) return false;
	return (await modifiedSince(join(gitDir, "HEAD"), since)) || (await modifiedSince(join(gitDir, "logs", "HEAD"), since));
}

export async function lastBashWriteDir(command: string, cwd: string, since: number): Promise<string | null> {
	const candidates = bashCandidates(command, cwd);
	const hits = await Promise.all(candidates.map((candidate) => written(candidate, since)));
	for (let i = candidates.length - 1; i >= 0; i--) {
		if (!hits[i]) continue;
		const candidate = candidates[i];
		return candidate.kind === "repo" ? candidate.path : dirname(candidate.path);
	}
	return null;
}
