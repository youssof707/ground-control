import {
	SCM_ROWS_BATCH,
	type ScmFileStatus,
	type ScmRowsReply,
	type ScmSummary,
} from "@shared/schemas/source_control";

export interface RowBuffer {
	checkout: string;
	scanId: number;
	fingerprint: string;
	listed: number;
	stagedListed: number;
	paths: string[];
	status: string;
	complete: boolean;
	index: Map<string, number> | null;
}

export type FillResult = "done" | "stale" | "failed" | "cancelled";

export interface RowsCall {
	id: number;
	promise: Promise<ScmRowsReply>;
}

export function createBuffer(summary: ScmSummary): RowBuffer {
	return {
		checkout: summary.checkout,
		scanId: summary.scanId,
		fingerprint: summary.fingerprint,
		listed: summary.listed,
		stagedListed: summary.stagedListed,
		paths: [],
		status: "",
		complete: summary.listed === 0,
		index: null,
	};
}

export function statusAt(buffer: RowBuffer, index: number): ScmFileStatus {
	return (buffer.status[index] ?? "M") as ScmFileStatus;
}

export function canReuse(buffer: RowBuffer | null, summary: ScmSummary): boolean {
	return (
		buffer !== null &&
		buffer.complete &&
		buffer.checkout === summary.checkout &&
		buffer.fingerprint === summary.fingerprint &&
		buffer.listed === summary.listed &&
		buffer.stagedListed === summary.stagedListed
	);
}

export function isStagedRow(buffer: RowBuffer, index: number): boolean {
	return index < buffer.stagedListed;
}

export function makeKey(staged: boolean, path: string): string {
	return `${staged ? "S" : "W"}${path}`;
}

export function keyStaged(key: string): boolean {
	return key.charCodeAt(0) === 83;
}

export function keyPath(key: string): string {
	return key.slice(1);
}

export function rowKey(buffer: RowBuffer, index: number): string {
	return makeKey(isStagedRow(buffer, index), buffer.paths[index] ?? "");
}

export function locate(buffer: RowBuffer, key: string, hint = -1): number {
	if (hint >= 0 && hint < buffer.paths.length && rowKey(buffer, hint) === key) return hint;
	if (!buffer.index) {
		const index = new Map<string, number>();
		for (let i = 0; i < buffer.paths.length; i++) index.set(rowKey(buffer, i), i);
		if (!buffer.complete) return index.get(key) ?? -1;
		buffer.index = index;
	}
	return buffer.index.get(key) ?? -1;
}

export async function fillRows(
	buffer: RowBuffer,
	fetchRows: (offset: number, limit: number) => RowsCall,
	hooks: {
		cancelled: () => boolean;
		onCall: (id: number | null) => void;
		onBatch: () => void;
	},
): Promise<FillResult> {
	while (buffer.paths.length < buffer.listed) {
		if (hooks.cancelled()) return "cancelled";
		const request = fetchRows(buffer.paths.length, SCM_ROWS_BATCH);
		hooks.onCall(request.id);
		const reply = await request.promise;
		hooks.onCall(null);
		if (hooks.cancelled()) return "cancelled";
		if (!reply.ok) {
			if (reply.reason === "stale") return "stale";
			return reply.reason === "cancelled" ? "cancelled" : "failed";
		}
		if (reply.offset !== buffer.paths.length || reply.paths.length === 0) return "failed";
		for (const path of reply.paths) buffer.paths.push(path);
		buffer.index = null;
		buffer.status += reply.status;
		hooks.onBatch();
	}
	buffer.complete = true;
	return "done";
}
