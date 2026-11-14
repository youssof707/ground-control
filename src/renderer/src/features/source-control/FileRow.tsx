import type { ScmFile, ScmFileStatus } from "@shared/schemas/source_control";
import { T } from "../../design/tokens";

const STATUS_COLOR: Record<ScmFileStatus, string> = {
	M: T.warn,
	A: T.ok,
	U: T.ok,
	D: T.danger,
	R: T.info,
	C: T.danger,
};

const STATUS_LABEL: Record<ScmFileStatus, string> = {
	M: "Modified",
	A: "Added",
	U: "Untracked",
	D: "Deleted",
	R: "Renamed",
	C: "Conflict",
};

function splitPath(path: string): { name: string; dir: string } {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const slash = trimmed.lastIndexOf("/");
	if (slash === -1) return { name: trimmed, dir: "" };
	return { name: trimmed.slice(slash + 1), dir: trimmed.slice(0, slash) };
}

export function FileRow({ file }: { file: ScmFile }) {
	const { name, dir } = splitPath(file.path);
	const color = STATUS_COLOR[file.status];

	return (
		<div
			role="listitem"
			style={{
				display: "flex",
				alignItems: "baseline",
				gap: 8,
				height: 24,
				lineHeight: "24px",
				padding: "0 12px 0 30px",
				fontSize: 12.5,
			}}
		>
			<span
				style={{
					color: file.status === "M" ? T.text : color,
					textDecoration: file.status === "D" ? "line-through" : "none",
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					flexShrink: 1,
					minWidth: 40,
				}}
			>
				{name}
			</span>
			<span
				style={{
					color: T.textFaint,
					fontSize: 11.5,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					flex: 1,
					minWidth: 0,
				}}
			>
				{dir}
			</span>
			<span
				aria-label={STATUS_LABEL[file.status]}
				style={{
					color,
					fontFamily: T.mono,
					fontSize: 11,
					fontWeight: 600,
					flexShrink: 0,
					width: 10,
					textAlign: "center",
				}}
			>
				{file.status}
			</span>
		</div>
	);
}
