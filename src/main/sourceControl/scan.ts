import { promises as fs } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { ScmFailure, ScmWorktree } from "../../shared/schemas/source_control";
import {
	GitAbortedError,
	GitMissingError,
	isNotARepo,
	runGit,
} from "./gitProcess";
import {
	createStatusParser,
	parseWorktreeList,
	type StatusEntry,
	type StatusHeader,
} from "./parseStatus";
import { createRecordSplitter } from "./recordStream";
import { readRepoInfo, RepoError } from "./branches";

export const STATUS_ARGS = [
	"status",
	"--porcelain=v2",
	"--branch",
	"-z",
	"--untracked-files=all",
	"--no-renames",
	"--ignore-submodules=dirty",
];

export interface ScanOk {
	ok: true;
	root: string;
	worktreeName: string | null;
	header: StatusHeader;
	entries: StatusEntry[];
	stagedListed: number;
	staged: number;
	unstaged: number;
	changed: number;
	conflicts: number;
	unpublished: number | null;
	worktrees: ScmWorktree[];
	durationMs: number;
}

export type ScanResult = ScanOk | { ok: false; reason: ScmFailure };

export interface ScanOptions {
	signal?: AbortSignal;
	cap: number;
}

class ScanFailure extends Error {
	constructor(readonly reason: ScmFailure) {
		super(reason);
	}
}

function failureOf(err: unknown): ScmFailure {
	if (err instanceof ScanFailure || err instanceof RepoError) return err.reason;
	if (err instanceof GitAbortedError) return "cancelled";
	if (err instanceof GitMissingError) return "git-missing";
	return "failed";
}

async function checkFolder(checkout: string): Promise<void> {
	try {
		const stat = await fs.stat(checkout);
		if (!stat.isDirectory()) throw new ScanFailure("missing-cwd");
	} catch (err) {
		if (err instanceof ScanFailure) throw err;
		throw new ScanFailure("missing-cwd");
	}
}

async function listWorktrees(
	checkout: string,
	signal: AbortSignal | undefined,
): Promise<ScmWorktree[]> {
	const result = await runGit({
		cwd: checkout,
		args: ["worktree", "list", "--porcelain", "-z"],
		signal,
		timeoutMs: 30_000,
	});
	if (result.code !== 0) {
		throw new ScanFailure(isNotARepo(result.stderr) ? "not-a-repo" : "failed");
	}
	return parseWorktreeList(result.stdout.toString("utf8")).map((e) => ({
		path: e.path,
		branch: e.branch,
		head: e.head,
		isMain: e.isMain,
	}));
}

async function realOrSelf(path: string): Promise<string> {
	try {
		return await fs.realpath(path);
	} catch {
		return path;
	}
}

export async function nestedWorktrees(root: string, worktrees: ScmWorktree[]): Promise<Set<string>> {
	const realRoot = await realOrSelf(root);
	const nested = new Set<string>();
	for (const worktree of worktrees) {
		const real = await realOrSelf(worktree.path);
		for (const [base, target] of [
			[root, worktree.path],
			[realRoot, real],
		]) {
			const rel = relative(base, target);
			if (rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)) nested.add(rel);
		}
	}
	return nested;
}

async function readStatus(
	checkout: string,
	cap: number,
	signal: AbortSignal | undefined,
	nested: ReadonlySet<string>,
): Promise<Omit<ScanOk, "ok" | "root" | "worktreeName" | "worktrees" | "durationMs" | "unpublished">> {
	const stagedEntries: StatusEntry[] = [];
	const unstagedEntries: StatusEntry[] = [];
	let staged = 0;
	let unstaged = 0;
	let changed = 0;
	let conflicts = 0;
	const parser = createStatusParser(
		(entry) => {
			if (entry.status === "C") conflicts++;
			if (entry.staged) {
				staged++;
				if (stagedEntries.length < cap) stagedEntries.push(entry);
			} else {
				unstaged++;
				if (unstagedEntries.length < cap) unstagedEntries.push(entry);
			}
		},
		() => {
			changed++;
		},
		(path) => nested.has(path.replace(/\/+$/, "")),
	);
	const splitter = createRecordSplitter(parser.feed);
	const result = await runGit({
		cwd: checkout,
		args: STATUS_ARGS,
		signal,
		onStdout: splitter.push,
	});
	if (result.code !== 0) {
		throw new ScanFailure(isNotARepo(result.stderr) ? "not-a-repo" : "failed");
	}
	splitter.end();
	const room = Math.max(0, cap - stagedEntries.length);
	const entries =
		unstagedEntries.length > room
			? stagedEntries.concat(unstagedEntries.slice(0, room))
			: stagedEntries.concat(unstagedEntries);
	return {
		header: parser.header,
		entries,
		stagedListed: stagedEntries.length,
		staged,
		unstaged,
		changed,
		conflicts,
	};
}

async function countUnpublished(checkout: string, signal: AbortSignal | undefined): Promise<number | null> {
	const origin = await runGit({
		cwd: checkout,
		args: ["config", "--get", "remote.origin.url"],
		signal,
		timeoutMs: 30_000,
	});
	if (origin.code !== 0) return null;
	const count = await runGit({
		cwd: checkout,
		args: ["rev-list", "--count", "HEAD", "--not", "--remotes=origin"],
		signal,
		timeoutMs: 30_000,
	});
	if (count.code !== 0) return null;
	const n = Number(count.stdout.toString("utf8").trim());
	return Number.isFinite(n) ? n : null;
}

export async function scanCheckout(
	checkout: string,
	options: ScanOptions,
): Promise<ScanResult> {
	const started = Date.now();
	const local = new AbortController();
	const onAbort = (): void => local.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	if (options.signal?.aborted) local.abort();
	try {
		await checkFolder(checkout);
		const listing = listWorktrees(checkout, local.signal);
		const top = readRepoInfo(checkout, local.signal);
		listing.catch(() => local.abort());
		top.catch(() => local.abort());
		const [worktrees, info] = await Promise.all([listing, top]);
		const nested = await nestedWorktrees(info.root, worktrees);
		const parsed = await readStatus(checkout, options.cap, local.signal, nested);
		const { header } = parsed;
		const unpublished =
			header.branch && !header.upstream && !header.unborn ? await countUnpublished(checkout, local.signal) : null;
		return {
			ok: true,
			root: info.root,
			worktreeName: info.worktreeName,
			...parsed,
			unpublished,
			worktrees,
			durationMs: Date.now() - started,
		};
	} catch (err) {
		if (options.signal?.aborted) return { ok: false, reason: "cancelled" };
		return { ok: false, reason: failureOf(err) };
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
	}
}
