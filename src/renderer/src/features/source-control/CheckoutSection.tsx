import type { ScmCheckout, ScmGroup } from "@shared/schemas/source_control";
import type { Worktree } from "@shared/schemas/worktrees";
import { T } from "../../design/tokens";
import { WorktreeChip } from "../../design/WorktreeChip";
import { FileRow } from "./FileRow";

function leafName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

function CountBadge({ n }: { n: number }) {
	return (
		<span
			style={{
				minWidth: 18,
				height: 16,
				padding: "0 5px",
				borderRadius: 8,
				background: T.surfaceHi,
				color: T.textDim,
				fontFamily: T.mono,
				fontSize: 10.5,
				fontWeight: 600,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				flexShrink: 0,
			}}
		>
			{n}
		</span>
	);
}

function Chevron({ expanded }: { expanded: boolean }) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			aria-hidden="true"
			style={{
				flexShrink: 0,
				transform: expanded ? "rotate(90deg)" : "none",
				transition: "transform 80ms ease",
			}}
		>
			<path
				d="M3.5 2L6.5 5L3.5 8"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function FileGroup({ label, group }: { label: string; group: ScmGroup }) {
	if (group.total === 0) return null;
	const hidden = group.total - group.files.length;

	return (
		<div role="group" aria-label={label}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					height: 24,
					padding: "0 12px 0 22px",
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: 0.3,
					textTransform: "uppercase",
					color: T.textMute,
				}}
			>
				<span style={{ flex: 1, minWidth: 0 }}>{label}</span>
				<CountBadge n={group.total} />
			</div>
			<div role="list">
				{group.files.map((file) => (
					<FileRow key={file.path} file={file} />
				))}
			</div>
			{hidden > 0 ? (
				<div
					style={{
						height: 24,
						lineHeight: "24px",
						padding: "0 12px 0 30px",
						fontSize: 11.5,
						color: T.textFaint,
					}}
				>
					+{hidden} more
				</div>
			) : null}
		</div>
	);
}

export function CheckoutSection({
	checkout,
	worktree,
	isCurrent,
	collapsed,
	onToggle,
}: {
	checkout: ScmCheckout;
	worktree?: Worktree;
	isCurrent: boolean;
	collapsed: boolean;
	onToggle: () => void;
}) {
	const total =
		checkout.merge.total + checkout.staged.total + checkout.changes.total;
	const dirty = checkout.ok && total > 0;
	const expanded = dirty && !collapsed;
	const refLabel = checkout.branch ?? checkout.head ?? "";
	const note = !checkout.ok ? "Unavailable" : total === 0 ? "No changes" : null;

	const header = (
		<>
			<span
				style={{
					width: 10,
					display: "inline-flex",
					color: T.textMute,
					visibility: dirty ? "visible" : "hidden",
				}}
			>
				<Chevron expanded={expanded} />
			</span>
			{worktree ? (
				<WorktreeChip
					displayName={worktree.displayName}
					color={worktree.color}
					variant="readonly"
					small
				/>
			) : (
				<span
					style={{
						fontSize: 12.5,
						fontWeight: 600,
						color: T.text,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						flexShrink: 1,
						minWidth: 30,
					}}
				>
					{leafName(checkout.path)}
				</span>
			)}
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 11,
					color: T.textMute,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					flex: 1,
					minWidth: 0,
					textAlign: "left",
				}}
			>
				{refLabel}
			</span>
			{isCurrent ? (
				<span
					role="img"
					aria-label="This session's checkout"
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: T.accent,
						flexShrink: 0,
					}}
				/>
			) : null}
			{note ? (
				<span style={{ fontSize: 11.5, color: T.textFaint, flexShrink: 0 }}>
					{note}
				</span>
			) : (
				<CountBadge n={total} />
			)}
		</>
	);

	const headerStyle = {
		display: "flex",
		alignItems: "center",
		gap: 8,
		width: "100%",
		height: 30,
		padding: "0 12px 0 8px",
		border: "none",
		background: "transparent",
		fontFamily: "inherit",
		textAlign: "left",
	} as const;

	return (
		<section style={{ borderBottom: `0.5px solid ${T.borderSoft}` }}>
			{dirty ? (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={expanded}
					style={{ ...headerStyle, cursor: "pointer" }}
				>
					{header}
				</button>
			) : (
				<div style={headerStyle}>{header}</div>
			)}
			{expanded ? (
				<div style={{ paddingBottom: 6 }}>
					<FileGroup label="Merge Changes" group={checkout.merge} />
					<FileGroup label="Staged Changes" group={checkout.staged} />
					<FileGroup label="Changes" group={checkout.changes} />
				</div>
			) : null}
		</section>
	);
}
