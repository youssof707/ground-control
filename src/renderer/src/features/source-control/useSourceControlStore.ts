import { create } from "zustand";
import type {
	GitFixRequest,
	GitFixResult,
	ScmCommitResult,
	ScmFailure,
	ScmRemoteOp,
	ScmSummary,
} from "@shared/schemas/source_control";
import {
	call,
	cancel,
	getConnection,
	onConnectionChange,
	type ScmConnection,
} from "./scmClient";
import { RefreshScheduler } from "./scmScheduler";

export interface ScmEntry {
	summary?: ScmSummary;
	loading: boolean;
	startedAt?: number;
	error?: ScmFailure;
}

interface State {
	connection: ScmConnection;
	byCheckout: Record<string, ScmEntry>;
	modalCheckout: string | null;
	modalComposer: string | null;
	openModal: (checkout: string, composer?: string) => void;
	closeModal: () => void;
	branchModal: BranchModalTarget | null;
	openBranches: (target: BranchModalTarget) => void;
	closeBranches: () => void;
	seenBranchSwitch: Record<string, string>;
	markBranchSwitchSeen: (sessionId: string, key: string) => void;
	viewed: Record<string, ReadonlySet<string>>;
	toggleViewed: (checkout: string, key: string) => void;
	comments: Record<string, ReviewComment[]>;
	addComment: (checkout: string, comment: Omit<ReviewComment, "id">) => void;
	editComment: (checkout: string, id: string, body: string) => void;
	removeComment: (checkout: string, id: string) => void;
	clearComments: (checkout: string) => void;
	remote: Record<string, RemoteState>;
	dismissRemoteError: (checkout: string) => void;
	commits: Record<string, CommitState>;
	dismissCommitError: (checkout: string) => void;
}

export interface CommitState {
	busy: "generating" | "committing" | "fixing" | null;
	error: string | null;
}

export interface ReviewComment {
	id: string;
	fileKey: string;
	path: string;
	startLine: number;
	endLine: number;
	code: string;
	body: string;
}

let commentSeq = 0;

function patchComments(
	all: Record<string, ReviewComment[]>,
	checkout: string,
	next: ReviewComment[],
): Record<string, ReviewComment[]> {
	const rest = { ...all };
	if (next.length === 0) delete rest[checkout];
	else rest[checkout] = next;
	return rest;
}

export interface RemoteState {
	busy: ScmRemoteOp | null;
	error: string | null;
	fixing?: boolean;
}

export interface BranchModalTarget {
	checkout: string;
	sessionId: string;
}

const HARD_FAILURES: ReadonlySet<ScmFailure> = new Set([
	"not-a-repo",
	"missing-cwd",
	"git-missing",
]);

export function isHardFailure(error: ScmFailure | undefined): boolean {
	return error !== undefined && HARD_FAILURES.has(error);
}

for (const key of ["gc.sourceControl.open", "gc.sourceControl.width"]) {
	try {
		window.localStorage.removeItem(key);
	} catch {
		break;
	}
}

export const useSourceControlStore = create<State>((set) => ({
	connection: getConnection(),
	byCheckout: {},
	modalCheckout: null,
	modalComposer: null,
	openModal: (checkout, composer) => {
		set({ modalCheckout: checkout, modalComposer: composer ?? null });
		requestRefresh(checkout, true);
	},
	closeModal: () => set({ modalCheckout: null, modalComposer: null }),
	branchModal: null,
	openBranches: (target) => set({ branchModal: target }),
	closeBranches: () => set({ branchModal: null }),
	seenBranchSwitch: {},
	markBranchSwitchSeen: (sessionId, key) =>
		set((s) =>
			s.seenBranchSwitch[sessionId] === key ? s : { seenBranchSwitch: { ...s.seenBranchSwitch, [sessionId]: key } },
		),
	viewed: {},
	toggleViewed: (checkout, key) =>
		set((s) => {
			const next = new Set(s.viewed[checkout]);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return { viewed: { ...s.viewed, [checkout]: next } };
		}),
	comments: {},
	addComment: (checkout, comment) =>
		set((s) => ({
			comments: patchComments(s.comments, checkout, [
				...(s.comments[checkout] ?? []),
				{ ...comment, id: `c${++commentSeq}` },
			]),
		})),
	editComment: (checkout, id, body) =>
		set((s) => ({
			comments: patchComments(
				s.comments,
				checkout,
				(s.comments[checkout] ?? []).map((c) => (c.id === id ? { ...c, body } : c)),
			),
		})),
	removeComment: (checkout, id) =>
		set((s) => ({
			comments: patchComments(
				s.comments,
				checkout,
				(s.comments[checkout] ?? []).filter((c) => c.id !== id),
			),
		})),
	clearComments: (checkout) => set((s) => ({ comments: patchComments(s.comments, checkout, []) })),
	remote: {},
	dismissRemoteError: (checkout) =>
		set((s) => ({ remote: { ...s.remote, [checkout]: { busy: s.remote[checkout]?.busy ?? null, error: null } } })),
	commits: {},
	dismissCommitError: (checkout) =>
		set((s) => ({ commits: { ...s.commits, [checkout]: { busy: s.commits[checkout]?.busy ?? null, error: null } } })),
}));

function patchCommit(checkout: string, next: CommitState): void {
	useSourceControlStore.setState((s) => ({ commits: { ...s.commits, [checkout]: next } }));
}

async function tryCommit(checkout: string, message: string, all: boolean): Promise<ScmCommitResult> {
	try {
		return await window.claude.commitStaged(checkout, message, all);
	} catch (err) {
		const text = err instanceof Error ? err.message : String(err);
		return { ok: false, error: text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") };
	}
}

export async function commitStaged(checkout: string, message: string, all: boolean): Promise<boolean> {
	if (useSourceControlStore.getState().commits[checkout]?.busy) return false;
	patchCommit(checkout, { busy: message.trim() ? "committing" : "generating", error: null });
	const first = await tryCommit(checkout, message, all);
	let error = first.ok ? null : first.error;
	if (!first.ok && first.failedMessage !== undefined) {
		patchCommit(checkout, { busy: "fixing", error: null });
		const fix = await autoFix(checkout, "commit", first.error, first.failedMessage);
		if (!fix.fixed) {
			error = `${first.error}\n\nClaude couldn't fix it: ${fix.reason}`;
		} else {
			const retry = await tryCommit(checkout, first.failedMessage, false);
			error = retry.ok ? null : `${retry.error}\n\nClaude tried: ${fix.reason}`;
		}
	}
	patchCommit(checkout, { busy: null, error: error ? `Couldn't commit: ${error}` : null });
	requestRefresh(checkout, true);
	return error === null;
}

function patchRemote(checkout: string, next: Partial<RemoteState>): void {
	useSourceControlStore.setState((s) => {
		const prev = s.remote[checkout] ?? { busy: null, error: null };
		return { remote: { ...s.remote, [checkout]: { ...prev, ...next } } };
	});
}

const REMOTE_ERRORS: Record<ScmRemoteOp, string> = {
	fetch: "Couldn't fetch from the remote.",
	pull: "Couldn't pull.",
	push: "Couldn't push.",
};

const fetching = new Set<string>();

export function backgroundFetch(checkout: string): void {
	if (fetching.has(checkout) || useSourceControlStore.getState().remote[checkout]?.busy) return;
	fetching.add(checkout);
	void call<"remote">({ t: "remote", checkout, op: "fetch" })
		.promise.then((reply) => {
			if (reply.ok) requestRefresh(checkout, true);
		})
		.finally(() => fetching.delete(checkout));
}

export async function runRemoteOp(checkout: string, op: ScmRemoteOp, sessionId?: string): Promise<void> {
	if (useSourceControlStore.getState().remote[checkout]?.busy) return;
	patchRemote(checkout, { busy: op, error: null });
	const reply = await call<"remote">({ t: "remote", checkout, op }).promise;
	let ok = reply.ok;
	let error = reply.ok || reply.reason === "cancelled" ? null : reply.message || REMOTE_ERRORS[op];
	if (error && op !== "fetch" && !reply.ok && reply.reason === "failed") {
		patchRemote(checkout, { fixing: true });
		const fix = await autoFix(checkout, op, error);
		ok = fix.fixed;
		error = fix.fixed ? null : `${error}\n\nClaude couldn't fix it: ${fix.reason}`;
	}
	patchRemote(checkout, { busy: null, error, fixing: false });
	requestRefresh(checkout, true);
	if (ok && sessionId) await window.claude.refreshBranch(sessionId).catch(() => undefined);
}

async function autoFix(
	checkout: string,
	op: GitFixRequest["op"],
	error: string,
	message?: string,
): Promise<GitFixResult> {
	const summary = useSourceControlStore.getState().byCheckout[checkout]?.summary;
	try {
		return await window.claude.autoFixGit({
			checkout,
			op,
			branch: summary?.branch ?? null,
			upstream: summary?.upstream ?? null,
			error,
			message,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { fixed: false, reason: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") };
	}
}

onConnectionChange((connection) => useSourceControlStore.setState({ connection }));

function patch(checkout: string, next: (prev: ScmEntry | undefined) => ScmEntry): void {
	useSourceControlStore.setState((s) => ({
		byCheckout: { ...s.byCheckout, [checkout]: next(s.byCheckout[checkout]) },
	}));
}

const scheduler = new RefreshScheduler({
	now: () => Date.now(),
	setTimer: (fn, ms) => window.setTimeout(fn, ms),
	clearTimer: (handle) => window.clearTimeout(handle as number),
	run: (checkout) => {
		const scan = call<"scan">({ t: "scan", checkout });
		patch(checkout, (prev) => ({ ...prev, loading: true, startedAt: Date.now() }));
		const promise = scan.promise.then((reply) => {
			if (reply.ok) {
				patch(checkout, () => ({ summary: reply.summary, loading: false }));
				return reply.summary.durationMs;
			}
			patch(checkout, (prev) => {
				if (reply.reason === "cancelled") return { ...prev, loading: false, startedAt: undefined };
				if (isHardFailure(reply.reason)) return { loading: false, error: reply.reason };
				return { summary: prev?.summary, loading: false, error: reply.reason };
			});
			return null;
		});
		return { promise, cancel: () => cancel(scan.id) };
	},
});

export function requestRefresh(checkout: string, urgent = false): void {
	scheduler.request(checkout, urgent);
}

export function keepOnlyRefreshing(checkouts: Iterable<string | null | undefined>): void {
	const keep = new Set<string>();
	for (const c of checkouts) if (c) keep.add(c);
	scheduler.cancelExcept(keep);
}

export function lastScanDuration(checkout: string): number {
	return scheduler.lastDuration(checkout);
}

export function branchSwitchKey(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

export function isSourceControlModalOpen(): boolean {
	const state = useSourceControlStore.getState();
	return state.modalCheckout !== null || state.branchModal !== null;
}
