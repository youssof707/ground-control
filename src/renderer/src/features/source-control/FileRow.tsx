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
			<input
				type="checkbox"
				className="scm-row-viewed"
				aria-label="Viewed"
				tabIndex={-1}
				checked={viewed}
				onMouseDown={(e) => {
					e.stopPropagation();
					e.preventDefault();
				}}
				onChange={() => onViewed(index)}
			/>
		</div>
	);
});
