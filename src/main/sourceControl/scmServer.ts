import {
	SCM_LIST_CAP,
	type ScmAction,
	type ScmBranchList,
	type ScmDiffContent,
	type ScmFailure,
	type ScmPick,
	type ScmReply,
	type ScmRequest,
	type ScmSummary,
} from "../../shared/schemas/source_control";
import { ApplyError, applyAction, type ApplyTarget } from "./apply";
import { listBranches, RepoError, switchBranch } from "./branches";
import { readDiff } from "./content";
import { GitAbortedError, GitMissingError } from "./gitProcess";
import type { StatusEntry } from "./parseStatus";
import { scanCheckout, type ScanResult } from "./scan";

const MAX_SCANS = 2;
const MAX_READS = 2;
const CACHE_SIZE = 3;
const MAX_ROWS = 5_000;

export interface ScmServerDeps {
	scan: (
		checkout: string,
		options: { signal: AbortSignal; cap: number },
	) => Promise<ScanResult>;
	diff: (
		checkout: string,
		entry: StatusEntry,
		options: { signal: AbortSignal; force: boolean },
	) => Promise<ScmDiffContent>;
	apply: (action: ScmAction, target: ApplyTarget) => Promise<void>;
	branches: (checkout: string, signal: AbortSignal) => Promise<ScmBranchList>;
	switchBranch: (checkout: string, branch: string, remote: boolean) => Promise<void>;
	cap: number;
}

export interface ScmConnection {
	handle: (message: unknown) => void;
	close: () => void;
}

interface Conn {
	send: (reply: ScmReply) => void;
	cancels: Map<number, () => void>;
	closed: boolean;
}

interface Waiter {
	conn: Conn;
	id: number;
}

interface Flight {
	controller: AbortController;
	waiters: Set<Waiter>;
	trailing: Set<Waiter>;
}

interface Cached {
	scanId: number;
	root: string;
	unborn: boolean;
	entries: StatusEntry[];
	byKey: Map<string, number> | null;
}

function entryKey(staged: boolean, path: string): string {
	return `${staged ? "S" : "W"}${path}`;
}

function isPick(value: unknown): value is ScmPick {
	return value === "all" || (Array.isArray(value) && value.every((p) => typeof p === "string"));
}

class Semaphore {
	private active = 0;
	private queue: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	acquire(signal: AbortSignal): Promise<() => void> {
		return new Promise((resolve, reject) => {
			const grant = (): void => {
				signal.removeEventListener("abort", onAbort);
				this.active++;
				let released = false;
				resolve(() => {
					if (released) return;
					released = true;
					this.active--;
					this.queue.shift()?.();
				});
			};
			const onAbort = (): void => {
				const index = this.queue.indexOf(grant);
				if (index !== -1) this.queue.splice(index, 1);
				reject(new GitAbortedError());
			};
			if (signal.aborted) {
				reject(new GitAbortedError());
				return;
			}
			if (this.active < this.limit) {
				grant();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			this.queue.push(grant);
		});
	}
}

export function fingerprint(entries: StatusEntry[]): string {
	let hash = 0x811c9dc5;
	for (const entry of entries) {
		const text = entry.path;
		for (let i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
		hash ^= entry.status.charCodeAt(0) | (entry.staged ? 0x200 : 0x100);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${entries.length}:${(hash >>> 0).toString(16)}`;
}

function failureOf(err: unknown): ScmFailure {
	if (err instanceof RepoError) return err.reason;
	if (err instanceof GitAbortedError) return "cancelled";
	if (err instanceof GitMissingError) return "git-missing";
	return "failed";
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isRequest(value: unknown): value is ScmRequest {
	if (!value || typeof value !== "object") return false;
	const msg = value as Record<string, unknown>;
	if (typeof msg.id !== "number") return false;
	switch (msg.t) {
		case "cancel":
			return true;
		case "scan":
		case "branches":
			return typeof msg.checkout === "string" && msg.checkout.startsWith("/");
		case "switch":
			return (
				typeof msg.checkout === "string" &&
				msg.checkout.startsWith("/") &&
				typeof msg.branch === "string" &&
				typeof msg.remote === "boolean"
			);
		case "rows":
			return (
				typeof msg.checkout === "string" &&
				typeof msg.scanId === "number" &&
				typeof msg.offset === "number" &&
				typeof msg.limit === "number"
			);
		case "diff":
			return (
				typeof msg.checkout === "string" &&
				typeof msg.scanId === "number" &&
				typeof msg.index === "number" &&
				typeof msg.path === "string" &&
				typeof msg.staged === "boolean" &&
				typeof msg.force === "boolean"
			);
		case "apply":
			return (
				typeof msg.checkout === "string" &&
				(msg.action === "stage" || msg.action === "unstage" || msg.action === "discard") &&
				isPick(msg.staged) &&
				isPick(msg.unstaged)
			);
		default:
			return false;
	}
}

export class ScmServer {
	private readonly flights = new Map<string, Flight>();
	private readonly cache = new Map<string, Cached>();
	private readonly scans = new Semaphore(MAX_SCANS);
	private readonly reads = new Semaphore(MAX_READS);
	private readonly writes = new Semaphore(1);
	private nextScanId = 0;

	constructor(private readonly deps: ScmServerDeps) {}

	connect(send: (reply: ScmReply) => void): ScmConnection {
		const conn: Conn = { send, cancels: new Map(), closed: false };
		return {
			handle: (message) => this.handle(conn, message),
			close: () => {
				conn.closed = true;
				for (const cancel of [...conn.cancels.values()]) cancel();
				conn.cancels.clear();
			},
		};
	}

	private reply(conn: Conn, reply: ScmReply): void {
		conn.cancels.delete(reply.id);
		if (conn.closed) return;
		try {
			conn.send(reply);
		} catch {
			conn.closed = true;
		}
	}

	private handle(conn: Conn, message: unknown): void {
		if (conn.closed || !isRequest(message)) return;
		switch (message.t) {
			case "cancel":
				conn.cancels.get(message.id)?.();
				return;
			case "scan":
				this.requestScan(conn, message.id, message.checkout);
				return;
			case "rows":
				this.rows(conn, message);
				return;
			case "diff":
				void this.diff(conn, message);
				return;
			case "apply":
				void this.apply(conn, message);
				return;
			case "branches":
				void this.branches(conn, message);
				return;
			case "switch":
				void this.switchBranch(conn, message);
				return;
		}
	}

	private requestScan(conn: Conn, id: number, checkout: string): void {
		const waiter: Waiter = { conn, id };
		const flight = this.flights.get(checkout);
		if (flight) {
			flight.trailing.add(waiter);
			conn.cancels.set(id, () => this.dropWaiter(checkout, waiter));
			return;
		}
		conn.cancels.set(id, () => this.dropWaiter(checkout, waiter));
		this.startFlight(checkout, new Set([waiter]));
	}

	private dropWaiter(checkout: string, waiter: Waiter): void {
		waiter.conn.cancels.delete(waiter.id);
		const flight = this.flights.get(checkout);
		if (!flight) return;
		flight.trailing.delete(waiter);
		if (flight.waiters.delete(waiter) && flight.waiters.size === 0) {
			flight.controller.abort();
		}
	}

	private startFlight(checkout: string, waiters: Set<Waiter>): void {
		const flight: Flight = {
			controller: new AbortController(),
			waiters,
			trailing: new Set(),
		};
		this.flights.set(checkout, flight);
		void this.runFlight(checkout, flight);
	}

	private async runFlight(checkout: string, flight: Flight): Promise<void> {
		const { signal } = flight.controller;
		let result: ScanResult;
		try {
			const release = await this.scans.acquire(signal);
			try {
				result = await this.deps.scan(checkout, { signal, cap: this.deps.cap });
			} finally {
				release();
			}
		} catch (err) {
			result = {
				ok: false,
				reason: err instanceof GitAbortedError ? "cancelled" : "failed",
			};
		}

		if (result.ok) {
			const scanId = ++this.nextScanId;
			this.remember(checkout, {
				scanId,
				root: result.root,
				unborn: result.header.unborn,
				entries: result.entries,
				byKey: null,
			});
			const summary: ScmSummary = {
				checkout,
				scanId,
				branch: result.header.branch,
				head: result.header.head,
				unborn: result.header.unborn,
				changed: result.changed,
				staged: result.staged,
				unstaged: result.unstaged,
				listed: result.entries.length,
				stagedListed: result.stagedListed,
				conflicts: result.conflicts,
				fingerprint: fingerprint(result.entries),
				worktrees: result.worktrees,
				worktreeName: result.worktreeName,
				fetchedAt: Date.now(),
				durationMs: result.durationMs,
			};
			for (const w of flight.waiters) {
				this.reply(w.conn, { t: "scan", id: w.id, ok: true, summary });
			}
		} else {
			for (const w of flight.waiters) {
				this.reply(w.conn, { t: "scan", id: w.id, ok: false, reason: result.reason });
			}
		}

		this.flights.delete(checkout);
		const trailing = [...flight.trailing].filter((w) => !w.conn.closed);
		if (trailing.length > 0) this.startFlight(checkout, new Set(trailing));
	}

	private remember(checkout: string, cached: Cached): void {
		this.cache.delete(checkout);
		this.cache.set(checkout, cached);
		while (this.cache.size > CACHE_SIZE) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
	}

	private touch(checkout: string): Cached | undefined {
		const cached = this.cache.get(checkout);
		if (cached) {
			this.cache.delete(checkout);
			this.cache.set(checkout, cached);
		}
		return cached;
	}

	private rows(
		conn: Conn,
		message: Extract<ScmRequest, { t: "rows" }>,
	): void {
		const cached = this.touch(message.checkout);
		if (!cached || cached.scanId !== message.scanId) {
			this.reply(conn, { t: "rows", id: message.id, ok: false, reason: "stale" });
			return;
		}
		const offset = Math.max(0, Math.floor(message.offset));
		const limit = Math.max(0, Math.min(MAX_ROWS, Math.floor(message.limit)));
		const slice = cached.entries.slice(offset, offset + limit);
		let status = "";
		const paths = new Array<string>(slice.length);
		for (let i = 0; i < slice.length; i++) {
			paths[i] = slice[i].path;
			status += slice[i].status;
		}
		this.reply(conn, { t: "rows", id: message.id, ok: true, offset, paths, status });
	}

	private lookup(cached: Cached, staged: boolean, path: string): StatusEntry | null {
		if (!cached.byKey) {
			cached.byKey = new Map();
			for (let i = 0; i < cached.entries.length; i++) {
				const entry = cached.entries[i];
				cached.byKey.set(entryKey(entry.staged, entry.path), i);
			}
		}
		const found = cached.byKey.get(entryKey(staged, path));
		return found === undefined ? null : cached.entries[found];
	}

	private findEntry(cached: Cached, index: number, staged: boolean, path: string): StatusEntry | null {
		const direct = cached.entries[index];
		if (direct && direct.path === path && direct.staged === staged) return direct;
		return this.lookup(cached, staged, path);
	}

	private pick(cached: Cached, staged: boolean, pick: ScmPick): StatusEntry[] | "all" {
		if (pick === "all") return "all";
		const out: StatusEntry[] = [];
		for (const path of pick) {
			const entry = this.lookup(cached, staged, path);
			if (entry) out.push(entry);
		}
		return out;
	}

	private async apply(
		conn: Conn,
		message: Extract<ScmRequest, { t: "apply" }>,
	): Promise<void> {
		const { id } = message;
		const cached = this.touch(message.checkout);
		if (!cached) {
			this.reply(conn, { t: "apply", id, ok: false, reason: "stale" });
			return;
		}
		const target: ApplyTarget = {
			root: cached.root,
			unborn: cached.unborn,
			staged: this.pick(cached, true, message.staged),
			unstaged: this.pick(cached, false, message.unstaged),
			allEntries: cached.entries,
		};
		const release = await this.writes.acquire(new AbortController().signal);
		try {
			await this.deps.apply(message.action, target);
			this.reply(conn, { t: "apply", id, ok: true });
		} catch (err) {
			this.reply(conn, {
				t: "apply",
				id,
				ok: false,
				reason: "failed",
				message: err instanceof ApplyError || err instanceof Error ? err.message : String(err),
			});
		} finally {
			release();
		}
	}

	private async branches(
		conn: Conn,
		message: Extract<ScmRequest, { t: "branches" }>,
	): Promise<void> {
		const { id } = message;
		const controller = new AbortController();
		conn.cancels.set(id, () => {
			conn.cancels.delete(id);
			controller.abort();
		});
		try {
			const release = await this.reads.acquire(controller.signal);
			try {
				const list = await this.deps.branches(message.checkout, controller.signal);
				this.reply(conn, { t: "branches", id, ok: true, list });
			} finally {
				release();
			}
		} catch (err) {
			this.reply(conn, {
				t: "branches",
				id,
				ok: false,
				reason: controller.signal.aborted ? "cancelled" : failureOf(err),
			});
		}
	}

	private async switchBranch(
		conn: Conn,
		message: Extract<ScmRequest, { t: "switch" }>,
	): Promise<void> {
		const { id } = message;
		const release = await this.writes.acquire(new AbortController().signal);
		try {
			await this.deps.switchBranch(message.checkout, message.branch, message.remote);
			this.reply(conn, { t: "switch", id, ok: true });
		} catch (err) {
			this.reply(conn, { t: "switch", id, ok: false, reason: failureOf(err), message: messageOf(err) });
		} finally {
			release();
		}
	}

	private async diff(
		conn: Conn,
		message: Extract<ScmRequest, { t: "diff" }>,
	): Promise<void> {
		const { id } = message;
		const cached = this.touch(message.checkout);
		const entry = cached ? this.findEntry(cached, message.index, message.staged, message.path) : null;
		if (!entry) {
			this.reply(conn, { t: "diff", id, ok: false, reason: "stale" });
			return;
		}
		const controller = new AbortController();
		conn.cancels.set(id, () => {
			conn.cancels.delete(id);
			controller.abort();
		});
		try {
			const release = await this.reads.acquire(controller.signal);
			try {
				const content = await this.deps.diff(cached?.root ?? message.checkout, entry, {
					signal: controller.signal,
					force: message.force,
				});
				this.reply(conn, { t: "diff", id, ok: true, content });
			} finally {
				release();
			}
		} catch (err) {
			if (controller.signal.aborted) {
				this.reply(conn, { t: "diff", id, ok: false, reason: "cancelled" });
				return;
			}
			const text =
				err instanceof GitAbortedError
					? "Timed out reading this file"
					: err instanceof Error
						? err.message
						: String(err);
			this.reply(conn, {
				t: "diff",
				id,
				ok: true,
				content: { kind: "error", message: text },
			});
		}
	}
}

export function createScmServer(): ScmServer {
	return new ScmServer({
		scan: scanCheckout,
		diff: readDiff,
		apply: applyAction,
		branches: listBranches,
		switchBranch,
		cap: SCM_LIST_CAP,
	});
}
