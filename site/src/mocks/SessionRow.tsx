import type { ReactNode } from "react";
import { BabysitBadge, BranchChip, Chevron, Dot, PlusIcon, StatusPill, type Status } from "./atoms";
import { cx } from "../lib/cx";

export type SessionRowProps = {
	title: string;
	summary: string;
	status: Status;
	detail?: string;
	branch?: string;
	folder?: string;
	unread?: boolean;
	active?: boolean;
	babysit?: boolean;
	tasks?: number;
	last?: boolean;
	className?: string;
};

export function SessionRow({ title, summary, status, detail, branch, folder, unread, active, babysit, tasks, last, className }: SessionRowProps) {
	return (
		<div className={cx("relative", !last && "border-b-[0.5px] border-gc-border-soft", active && "bg-gc-text/[0.04]", className)}>
			{active && <span className="absolute inset-y-0 left-0 w-[3px] bg-gc-accent" />}
			<div className="flex flex-col gap-1.5 px-3.5 py-3">
				<div className="flex items-center gap-2">
					{unread && <Dot tone="bg-gc-accent" size={7} />}
					<span className={cx("min-w-0 flex-1 truncate text-[13.5px] text-gc-text", unread ? "font-semibold" : "font-medium")}>{title}</span>
					<span className="text-[12px] tracking-widest text-gc-text-faint">⋯</span>
				</div>
				<div className="line-clamp-2 text-[12px] leading-[1.35] text-gc-text-mute">{summary}</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{tasks ? (
						<span className="inline-flex h-[22px] items-center gap-1.5 rounded-[11px] border-[0.5px] border-gc-text/40 bg-gc-text/14 px-[9px] text-[11.5px] font-medium text-gc-text">
							<Dot tone="bg-white" />
							{tasks} {tasks === 1 ? "task" : "tasks"}
						</span>
					) : (
						<StatusPill status={status} detail={detail} />
					)}
					{babysit && <BabysitBadge />}
					{branch && <BranchChip name={branch} />}
				</div>
				{folder && <div className="truncate font-mono text-[11px] text-gc-text-faint">{folder}</div>}
			</div>
		</div>
	);
}

export function SectionHeader({ name, open, tone, badges, className }: { name: string; open?: boolean; tone?: "info" | "danger" | "neutral"; badges?: { waiting?: number; running?: number; tasks?: number }; className?: string }) {
	const color = tone === "info" ? "text-gc-info/80" : tone === "danger" ? "text-gc-danger/80" : "text-gc-text-mute";
	return (
		<div className={cx("flex items-center gap-[7px] px-3 py-[9px]", open && "border-b-[0.5px] border-gc-border-soft", className)}>
			<span className="text-gc-text-faint"><Chevron open={open} /></span>
			<span className={cx("text-[11px] font-semibold tracking-[0.5px] uppercase", color)}>{name}</span>
			{!open && badges && (
				<span className="ml-auto flex items-center gap-[5px]">
					{badges.waiting ? <Badge tone="bg-gc-warn/14 text-gc-warn">{badges.waiting}</Badge> : null}
					{badges.running ? <Badge tone="bg-gc-ok/14 text-gc-ok">{badges.running}</Badge> : null}
					{badges.tasks ? <Badge tone="bg-gc-text/14 text-gc-text">{badges.tasks}</Badge> : null}
				</span>
			)}
			<span className={cx("flex h-6 w-6 items-center justify-center rounded text-gc-text-faint", open && "ml-auto")}><PlusIcon size={11} /></span>
		</div>
	);
}

function Badge({ tone, children }: { tone: string; children: number }) {
	return <span className={cx("inline-flex h-4 min-w-4 items-center justify-center rounded-lg px-[5px] font-mono text-[10px] font-semibold tracking-[-0.2px]", tone)}>{children}</span>;
}

export function Well({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cx("my-2 border-t border-gc-border-soft bg-gc-bg", className)}>{children}</div>;
}
