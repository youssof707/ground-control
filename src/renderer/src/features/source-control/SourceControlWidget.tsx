import { T } from "../../design/tokens";
import { compactCount, plural } from "./format";
import { isHardFailure, useSourceControlStore } from "./useSourceControlStore";

export function FilesIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<path
				d="M8.5 1.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4L8.5 1.5Z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<path d="M8.5 1.5V4H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
			<path d="M5.5 8h3M7 6.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
		</svg>
	);
}

export function WorktreesIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<circle cx="4" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<circle cx="10.5" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M4 4.5v5M10.5 6.5c0 2-2.5 2.2-5.4 3.6"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function SourceControlWidget({ checkout }: { checkout: string | undefined }) {
	const changed = useSourceControlStore((s) =>
		checkout ? s.byCheckout[checkout]?.summary?.changed : undefined,
	);
	const conflicts = useSourceControlStore((s) =>
		checkout ? s.byCheckout[checkout]?.summary?.conflicts ?? 0 : 0,
	);
	const worktrees = useSourceControlStore((s) => {
		const list = checkout ? s.byCheckout[checkout]?.summary?.worktrees : undefined;
		if (!list) return 0;
		let linked = 0;
		for (const w of list) if (!w.isMain) linked++;
		return linked;
	});
	const error = useSourceControlStore((s) =>
		checkout ? s.byCheckout[checkout]?.error : undefined,
	);
	const openModal = useSourceControlStore((s) => s.openModal);

	if (!checkout || isHardFailure(error)) return null;

	const filesText =
		changed === undefined
			? "Checking for changes…"
			: changed === 0
				? "No changes"
				: `${compactCount(changed)} ${changed === 1 ? "file" : "files"} changed`;
	const worktreesText =
		worktrees > 0 ? `${compactCount(worktrees)} ${worktrees === 1 ? "worktree" : "worktrees"}` : null;
	const label =
		changed === undefined
			? "Source control, checking for changes"
			: `Source control: ${plural(changed, "file", "files")} changed${worktreesText ? `, ${plural(worktrees, "worktree", "worktrees")}` : ""}`;

	return (
		<button
			type="button"
			className="scm-widget"
			onClick={() => openModal(checkout)}
			aria-label={label}
			aria-haspopup="dialog"
		>
			<span style={{ display: "inline-flex", color: conflicts > 0 ? T.danger : changed ? T.warn : T.textMute }}>
				<FilesIcon />
			</span>
			<span style={{ color: conflicts > 0 ? T.danger : undefined }}>{filesText}</span>
			{worktreesText ? (
				<>
					<span className="scm-widget-sep" aria-hidden="true">·</span>
					<span style={{ display: "inline-flex" }}>
						<WorktreesIcon />
					</span>
					<span>{worktreesText}</span>
				</>
			) : null}
		</button>
	);
}
