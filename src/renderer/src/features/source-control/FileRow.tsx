import { memo, type MouseEvent } from "react";
import type { ScmFileStatus } from "@shared/schemas/source_control";

export const STATUS_LABEL: Record<ScmFileStatus, string> = {
	M: "Modified",
	A: "Added",
	U: "Untracked",
	D: "Deleted",
	R: "Renamed",
	C: "Conflict",
};

export interface RowPointer {
	toggle: boolean;
	range: boolean;
}

export function splitPath(path: string): { name: string; dir: string } {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const slash = trimmed.lastIndexOf("/");
	if (slash === -1) return { name: trimmed, dir: "" };
	return { name: trimmed.slice(slash + 1), dir: trimmed.slice(0, slash) };
}

export function rowId(index: number): string {
	return `scm-row-${index}`;
}

export const FileRow = memo(function FileRow({
	index,
	path,
	status,
	staged,
	top,
	height,
	selected,
	focused,
	viewed,
	onPointer,
	onContext,
	onViewed,
}: {
	index: number;
	path: string;
	status: ScmFileStatus;
	staged: boolean;
	top: number;
	height: number;
	selected: boolean;
	focused: boolean;
	viewed: boolean;
	onPointer: (index: number, pointer: RowPointer) => void;
	onContext: (index: number, x: number, y: number) => void;
	onViewed: (index: number) => void;
}) {
	const { name, dir } = splitPath(path);

	return (
		<div
			id={rowId(index)}
			role="option"
			aria-selected={selected}
			aria-label={`${path}, ${STATUS_LABEL[status]}${staged ? ", staged" : ""}`}
			className="scm-row"
			data-focused={focused || undefined}
			data-viewed={viewed || undefined}
			onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
				if (e.button !== 0) return;
				onPointer(index, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
			}}
			onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
				e.preventDefault();
				onContext(index, e.clientX, e.clientY);
			}}
			style={{ top, height }}
		>
			<span className={status === "D" ? "scm-row-name scm-row-deleted" : "scm-row-name"}>{name}</span>
			<span className="scm-row-dir">
				<bdi>{dir}</bdi>
			</span>
			<button
				type="button"
				className="scm-row-viewed"
				aria-label={viewed ? "Viewed, mark as not viewed" : "Mark as viewed"}
				aria-pressed={viewed}
				tabIndex={-1}
				onMouseDown={(e) => {
					e.stopPropagation();
					e.preventDefault();
				}}
				onClick={() => onViewed(index)}
			>
				{viewed ? (
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M3 8.5l3.2 3.2L13 4.8" />
					</svg>
				) : (
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
						<circle cx="8" cy="8" r="2" />
					</svg>
				)}
			</button>
		</div>
	);
});
