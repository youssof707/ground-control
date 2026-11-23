export type ScmFileStatus = "M" | "A" | "D" | "R" | "U" | "C";

export const SCM_LIST_CAP = 50_000;
export const SCM_ROWS_BATCH = 2_000;

export type ScmFailure =
	| "not-a-repo"
	| "missing-cwd"
	| "git-missing"
	| "failed"
	| "cancelled";

export interface ScmWorktree {
	path: string;
	branch: string | null;
	head: string | null;
	isMain: boolean;
}

export interface ScmSummary {
	checkout: string;
	scanId: number;
	branch: string | null;
	head: string | null;
	unborn: boolean;
	changed: number;
	staged: number;
	unstaged: number;
	listed: number;
	stagedListed: number;
	conflicts: number;
	fingerprint: string;
	worktrees: ScmWorktree[];
	worktreeName: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	unpublished: number | null;
	fetchedAt: number;
	durationMs: number;
}

export interface ScmBranch {
	name: string;
	remote: string | null;
	date: number;
	worktree: string | null;
}

export interface ScmBranchList {
	current: string | null;
	worktreeName: string | null;
	branches: ScmBranch[];
	fetchedAt: number;
}

export type ScmDiffContent =
	| {
		kind: "text";
		original: string;
		modified: string;
		lossy: boolean;
	}
	| { kind: "binary" }
	| { kind: "too-large"; bytes: number; canForce: boolean }
	| { kind: "submodule" }
	| { kind: "directory" }
	| { kind: "gone" }
	| { kind: "error"; message: string };

export type ScmAction = "stage" | "unstage" | "discard";

export type ScmPick = "all" | string[];

export type ScmRemoteOp = "fetch" | "pull" | "push";

export interface GitFixRequest {
	checkout: string;
	op: "pull" | "push";
	branch: string | null;
	upstream: string | null;
	error: string;
}

export type ScmCommitResult = { ok: true; message: string } | { ok: false; error: string };

export interface GitFixResult {
	fixed: boolean;
	reason: string;
}

export type ScmRequest =
	| { t: "scan"; id: number; checkout: string }
	| {
		t: "rows";
		id: number;
		checkout: string;
		scanId: number;
		offset: number;
		limit: number;
	}
	| {
		t: "diff";
		id: number;
		checkout: string;
		scanId: number;
		index: number;
		path: string;
		staged: boolean;
		force: boolean;
	}
	| {
		t: "apply";
		id: number;
		checkout: string;
		action: ScmAction;
		staged: ScmPick;
		unstaged: ScmPick;
	}
	| { t: "branches"; id: number; checkout: string }
	| { t: "switch"; id: number; checkout: string; branch: string; remote: boolean }
	| { t: "remote"; id: number; checkout: string; op: ScmRemoteOp }
	| { t: "cancel"; id: number };

export type ScmCallKind = Exclude<ScmRequest["t"], "cancel">;

export type ScmScanReply =
	| { t: "scan"; id: number; ok: true; summary: ScmSummary }
	| { t: "scan"; id: number; ok: false; reason: ScmFailure };

export type ScmRowsReply =
	| {
		t: "rows";
		id: number;
		ok: true;
		offset: number;
		paths: string[];
		status: string;
	}
	| { t: "rows"; id: number; ok: false; reason: ScmFailure | "stale" };

export type ScmDiffReply =
	| { t: "diff"; id: number; ok: true; content: ScmDiffContent }
	| { t: "diff"; id: number; ok: false; reason: ScmFailure | "stale" };

export type ScmApplyReply =
	| { t: "apply"; id: number; ok: true }
	| { t: "apply"; id: number; ok: false; reason: ScmFailure | "stale"; message?: string };

export type ScmBranchesReply =
	| { t: "branches"; id: number; ok: true; list: ScmBranchList }
	| { t: "branches"; id: number; ok: false; reason: ScmFailure };

export type ScmSwitchReply =
	| { t: "switch"; id: number; ok: true }
	| { t: "switch"; id: number; ok: false; reason: ScmFailure; message?: string };

export type ScmRemoteReply =
	| { t: "remote"; id: number; ok: true }
	| { t: "remote"; id: number; ok: false; reason: ScmFailure; message?: string };

export type ScmReply =
	| ScmScanReply
	| ScmRowsReply
	| ScmDiffReply
	| ScmApplyReply
	| ScmBranchesReply
	| ScmSwitchReply
	| ScmRemoteReply;

export type ScmReplyFor<K extends ScmCallKind> = Extract<ScmReply, { t: K }>;

export type ScmCallFor<K extends ScmCallKind> = Omit<
	Extract<ScmRequest, { t: K }>,
	"id"
>;

export const SCM_PORT_MESSAGE = "gc-scm-port";
