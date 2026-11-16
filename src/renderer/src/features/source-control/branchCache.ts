import { create } from "zustand";
import type { ScmBranchList, ScmFailure } from "@shared/schemas/source_control";
import { call } from "./scmClient";

const STORAGE_KEY = "gc.branches.v1";
const PERSISTED_CHECKOUTS = 8;
const PERSISTED_BRANCHES = 2_000;
export const BRANCH_PREFETCH_MAX_AGE_MS = 30_000;

let memory: Map<string, ScmBranchList> | null = null;
let persistTimer: number | null = null;

function isList(value: unknown): value is ScmBranchList {
	if (!value || typeof value !== "object") return false;
	const list = value as Partial<ScmBranchList>;
	return Array.isArray(list.branches) && typeof list.fetchedAt === "number";
}

function load(): Map<string, ScmBranchList> {
	if (memory) return memory;
	memory = new Map();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				if (Array.isArray(item) && typeof item[0] === "string" && isList(item[1])) {
					memory.set(item[0], item[1]);
				}
			}
		}
	} catch {
		memory.clear();
	}
	return memory;
}

function persist(): void {
	persistTimer = null;
	const entries = [...load().entries()].slice(-PERSISTED_CHECKOUTS).map(([checkout, list]) => [
		checkout,
		{ ...list, branches: list.branches.slice(0, PERSISTED_BRANCHES) },
	]);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {
			return;
		}
	}
}

export function cachedBranches(checkout: string): ScmBranchList | undefined {
	return load().get(checkout);
}

export function rememberBranches(checkout: string, list: ScmBranchList): void {
	const map = load();
	map.delete(checkout);
	map.set(checkout, list);
	while (map.size > PERSISTED_CHECKOUTS * 2) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
	if (persistTimer === null) persistTimer = window.setTimeout(persist, 250);
}

interface BranchState {
	lists: Record<string, ScmBranchList>;
	loading: Record<string, boolean>;
	errors: Record<string, ScmFailure | undefined>;
}

export const useBranchStore = create<BranchState>(() => ({ lists: {}, loading: {}, errors: {} }));

const flights = new Map<string, Promise<void>>();

export function branchListFor(checkout: string): ScmBranchList | undefined {
	const live = useBranchStore.getState().lists[checkout];
	if (live) return live;
	const cached = cachedBranches(checkout);
	if (cached) {
		useBranchStore.setState((s) => ({ lists: { ...s.lists, [checkout]: cached } }));
	}
	return cached;
}

export function refreshBranches(checkout: string, maxAgeMs = 0): Promise<void> {
	const existing = flights.get(checkout);
	if (existing) return existing;
	const known = branchListFor(checkout);
	if (known && maxAgeMs > 0 && Date.now() - known.fetchedAt < maxAgeMs) return Promise.resolve();
	useBranchStore.setState((s) => ({ loading: { ...s.loading, [checkout]: true } }));
	const flight = call<"branches">({ t: "branches", checkout })
		.promise.then((reply) => {
			if (reply.ok) {
				rememberBranches(checkout, reply.list);
				useBranchStore.setState((s) => ({
					lists: { ...s.lists, [checkout]: reply.list },
					errors: { ...s.errors, [checkout]: undefined },
				}));
			} else if (reply.reason !== "cancelled") {
				useBranchStore.setState((s) => ({ errors: { ...s.errors, [checkout]: reply.reason } }));
			}
		})
		.finally(() => {
			flights.delete(checkout);
			useBranchStore.setState((s) => ({ loading: { ...s.loading, [checkout]: false } }));
		});
	flights.set(checkout, flight);
	return flight;
}

export function markCurrentBranch(checkout: string, current: string): void {
	const list = branchListFor(checkout);
	if (!list) return;
	const next = { ...list, current };
	rememberBranches(checkout, next);
	useBranchStore.setState((s) => ({ lists: { ...s.lists, [checkout]: next } }));
}
