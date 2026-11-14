import { create } from "zustand";
import {
	ScmSnapshotSchema,
	type ScmFailureReason,
	type ScmSnapshotOk,
} from "@shared/schemas/source_control";

export const SCM_MIN_WIDTH = 240;
export const SCM_MAX_WIDTH = 640;
const SCM_DEFAULT_WIDTH = 300;
const OPEN_KEY = "gc.sourceControl.open";
const WIDTH_KEY = "gc.sourceControl.width";

export interface ScmRootState {
	snapshot?: ScmSnapshotOk;
	loading: boolean;
	error?: ScmFailureReason;
}

interface State {
	open: boolean;
	width: number;
	byRoot: Record<string, ScmRootState>;
	collapsed: Record<string, true>;
	setOpen: (open: boolean) => void;
	setWidth: (width: number) => void;
	toggleCollapsed: (checkoutPath: string) => void;
	refresh: (cwd: string) => Promise<void>;
}

function readStored(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStored(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		return;
	}
}

function readStoredWidth(): number {
	const parsed = Number(readStored(WIDTH_KEY));
	if (!Number.isFinite(parsed) || parsed <= 0) return SCM_DEFAULT_WIDTH;
	return Math.min(SCM_MAX_WIDTH, Math.max(SCM_MIN_WIDTH, Math.round(parsed)));
}

async function fetchSnapshot(
	cwd: string,
): Promise<ScmSnapshotOk | ScmFailureReason> {
	try {
		const raw = await window.claude?.getSourceControlSnapshot(cwd);
		const parsed = ScmSnapshotSchema.safeParse(raw);
		if (!parsed.success) return "failed";
		return parsed.data.ok ? parsed.data : parsed.data.reason;
	} catch {
		return "failed";
	}
}

export const useSourceControlStore = create<State>((set, get) => ({
	open: readStored(OPEN_KEY) === "1",
	width: readStoredWidth(),
	byRoot: {},
	collapsed: {},
	setOpen: (open) => {
		writeStored(OPEN_KEY, open ? "1" : "0");
		set({ open });
	},
	setWidth: (width) => {
		writeStored(WIDTH_KEY, String(width));
		set({ width });
	},
	toggleCollapsed: (checkoutPath) =>
		set((s) => {
			const next = { ...s.collapsed };
			if (next[checkoutPath]) delete next[checkoutPath];
			else next[checkoutPath] = true;
			return { collapsed: next };
		}),
	refresh: async (cwd) => {
		if (!cwd || get().byRoot[cwd]?.loading) return;
		set((s) => ({
			byRoot: { ...s.byRoot, [cwd]: { ...s.byRoot[cwd], loading: true } },
		}));
		const result = await fetchSnapshot(cwd);
		set((s) => {
			const previous = s.byRoot[cwd];
			const next: ScmRootState =
				typeof result !== "string"
					? { snapshot: result, loading: false }
					: result === "not-a-repo"
						? { loading: false, error: result }
						: { snapshot: previous?.snapshot, loading: false, error: result };
			return { byRoot: { ...s.byRoot, [cwd]: next } };
		});
	},
}));
