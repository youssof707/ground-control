import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";

export type Status = "idle" | "running" | "planning" | "planning complete" | "waiting for input" | "done" | "cancelled" | "errored" | "usage limit";

const statusTone: Record<Status, { dot: string; text: string; bg: string; border: string; ring?: boolean }> = {
	"idle": { dot: "bg-gc-text-mute", text: "text-gc-text-dim", bg: "bg-transparent", border: "border-gc-border" },
	"running": { dot: "bg-gc-ok", text: "text-gc-ok", bg: "bg-gc-ok/14", border: "border-gc-ok/30", ring: true },
	"planning": { dot: "bg-gc-ok", text: "text-gc-ok", bg: "bg-gc-ok/14", border: "border-gc-ok/30", ring: true },
	"planning complete": { dot: "bg-gc-warn", text: "text-gc-warn", bg: "bg-gc-warn/14", border: "border-gc-warn/40" },
	"waiting for input": { dot: "bg-gc-warn", text: "text-gc-warn", bg: "bg-gc-warn/14", border: "border-gc-warn/40" },
	"done": { dot: "bg-gc-info", text: "text-gc-info", bg: "bg-gc-info/14", border: "border-gc-info/30" },
	"cancelled": { dot: "bg-gc-text-mute", text: "text-gc-text-dim", bg: "bg-gc-surface", border: "border-gc-border" },
	"errored": { dot: "bg-gc-danger", text: "text-gc-danger", bg: "bg-gc-danger/14", border: "border-gc-danger/40" },
	"usage limit": { dot: "bg-gc-danger", text: "text-gc-danger", bg: "bg-gc-danger/14", border: "border-gc-danger/40" },
};

export function StatusPill({ status, detail }: { status: Status; detail?: string }) {
	const t = statusTone[status];
	return (
		<span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-[11px] border-[0.5px] px-[9px] text-[11.5px] font-medium tracking-[0.1px] whitespace-nowrap", t.text, t.bg, t.border)}>
			<span className={cx("h-1.5 w-1.5 rounded-full", t.dot, t.ring && "animate-ring")} />
			{status}
			{detail && <span className="font-mono opacity-80">· {detail}</span>}
		</span>
	);
}

export function BabysitBadge() {
	return (
		<span className="inline-flex h-[22px] items-center rounded-[11px] border-[0.5px] border-gc-babysit/40 bg-gc-babysit/14 pl-[9px] text-[11.5px] font-medium text-gc-babysit whitespace-nowrap">
			<span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-gc-babysit" />
			babysitting
			<svg width="8" height="8" viewBox="0 0 8 8" className="mx-[8px] ml-[5px] opacity-60" fill="none" stroke="currentColor" strokeWidth="1.4">
				<path d="M1 1l6 6M7 1L1 7" />
			</svg>
		</span>
	);
}

export function BranchIcon({ size = 11 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
			<circle cx="3" cy="2.5" r="1.3" />
			<circle cx="3" cy="9.5" r="1.3" />
			<circle cx="9" cy="3.5" r="1.3" />
			<path d="M3 4v4M3 8c0-2 6-2 6-4" />
		</svg>
	);
}

export function BranchChip({ name, tone = "normal" }: { name: string; tone?: "normal" | "stale" }) {
	const stale = tone === "stale";
	return (
		<span
			className={cx(
				"inline-flex h-[22px] max-w-[200px] items-center gap-1.5 rounded-[11px] border-[0.5px] pr-[9px] pl-[7px] font-mono text-[11.5px] whitespace-nowrap",
				stale ? "border-gc-danger/40 bg-gc-danger/14 text-gc-danger" : "border-gc-border bg-gc-surface text-gc-text-dim",
			)}
		>
			<BranchIcon />
			<span className="truncate">{name}</span>
		</span>
	);
}

export function ModeChip({ mode }: { mode: "Plan" | "Auto-edit" }) {
	const plan = mode === "Plan";
	return (
		<span
			className={cx(
				"inline-flex h-[22px] items-center rounded-[11px] border-[0.5px] px-[9px] text-[11.5px] font-medium",
				plan ? "border-gc-info/30 bg-gc-info/14 text-gc-info" : "border-gc-warn/40 bg-gc-warn/14 text-gc-warn",
			)}
		>
			{mode}
		</span>
	);
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<kbd className={cx("inline-flex h-[18px] items-center rounded-[4px] border-[0.5px] border-gc-border bg-gc-bg px-1.5 font-mono text-[10.5px] text-gc-text-dim", className)}>
			{children}
		</kbd>
	);
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cx("text-[10.5px] font-semibold tracking-[0.6px] text-gc-text-mute uppercase", className)}>{children}</div>;
}

type BtnTone = "default" | "primary" | "warn" | "babysit" | "danger" | "ghost";

const btnTone: Record<BtnTone, string> = {
	default: "border-gc-border bg-gc-surface text-gc-text",
	primary: "border-transparent bg-gc-accent text-gc-accent-ink",
	warn: "border-transparent bg-gc-warn text-gc-accent-ink",
	babysit: "border-transparent bg-gc-babysit text-gc-accent-ink",
	danger: "border-transparent bg-gc-danger text-white",
	ghost: "border-transparent bg-transparent text-gc-text-dim",
};

export function Btn({ tone = "default", children, className, size = "md" }: { tone?: BtnTone; children: ReactNode; className?: string; size?: "md" | "sm" }) {
	return (
		<span
			className={cx(
				"inline-flex items-center justify-center gap-1.5 rounded-lg border-[0.5px] font-medium whitespace-nowrap",
				size === "md" ? "h-8 px-3.5 text-[13px]" : "h-7 px-3 text-[12px]",
				btnTone[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}

export function IconBtn({ children, className, active }: { children: ReactNode; className?: string; active?: boolean }) {
	return (
		<span className={cx("inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border-[0.5px] border-gc-border text-gc-text-dim", active ? "bg-gc-danger text-white" : "bg-gc-surface", className)}>
			{children}
		</span>
	);
}

export function BoltIcon({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
			<path d="M7.8 1.5L3.5 7.8h3.1l-.4 4.7 4.3-6.3H7.4l.4-4.7z" />
		</svg>
	);
}

export function MicIcon({ size = 13 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
			<rect x="4.5" y="0.9" width="3" height="5.4" rx="1.5" />
			<path d="M2.7 5.4a3.3 3.3 0 0 0 6.6 0" />
			<path d="M6 8.7v1.5M4.3 10.9h3.4" />
		</svg>
	);
}

export function ArrowIcon({ size = 11 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<path d="M2 6h8M7 3l3 3-3 3" />
		</svg>
	);
}

export function Chevron({ open, size = 8 }: { open?: boolean; size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cx("transition-transform", open && "rotate-90")}>
			<path d="M2.5 1.5L6 4L2.5 6.5" />
		</svg>
	);
}

export function PlusIcon({ size = 13 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
			<path d="M7 3v8M3 7h8" />
		</svg>
	);
}

export function XIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
			<path d="M3 3l6 6M9 3l-6 6" />
		</svg>
	);
}

export function Spinner({ size = 9 }: { size?: number }) {
	return <span className="inline-block animate-spin-slow rounded-full border-[1.5px] border-current border-r-transparent" style={{ width: size, height: size }} />;
}

export function Logo({ size = 22 }: { size?: number }) {
	const style: CSSProperties = { width: size, height: size, fontSize: size / 2 };
	return (
		<span className="inline-flex items-center justify-center rounded-md border-[0.5px] border-gc-accent/40 bg-gc-accent/14 font-mono font-bold text-gc-accent" style={style}>
			{"</>"}
		</span>
	);
}

export function ModeToggle({ mode }: { mode: "Plan" | "Auto-edit" }) {
	return (
		<span className="inline-flex h-6 items-center rounded-lg border-[0.5px] border-gc-border-soft p-0.5">
			{(["Plan", "Auto-edit"] as const).map((m) => (
				<span
					key={m}
					className={cx("inline-flex h-5 items-center rounded-md px-2 text-[11.5px]", m === mode ? "bg-gc-surface-hi font-medium text-gc-text" : "text-gc-text-faint")}
				>
					{m}
				</span>
			))}
		</span>
	);
}

export function Segmented({ options, active, tones }: { options: string[]; active: string; tones?: Record<string, string> }) {
	return (
		<span className="inline-flex items-center gap-0.5 rounded-[7px] border-[0.5px] border-gc-border bg-gc-bg p-0.5">
			{options.map((o) => (
				<span
					key={o}
					className={cx(
						"inline-flex items-center rounded-[5px] px-2.5 py-[5px] text-[11.5px] whitespace-nowrap",
						o === active ? cx("bg-gc-surface-hi font-semibold", tones?.[o] ?? "text-gc-text") : "font-medium text-gc-text-dim",
					)}
				>
					{o}
				</span>
			))}
		</span>
	);
}

export function Input({ placeholder, value, className, mono }: { placeholder?: string; value?: string; className?: string; mono?: boolean }) {
	return (
		<span
			className={cx(
				"flex h-[30px] items-center rounded-md border-[0.5px] border-gc-border bg-gc-surface-low px-[9px] text-[12.5px]",
				value ? "text-gc-text" : "text-gc-text-faint",
				mono && "font-mono",
				className,
			)}
		>
			{value ?? placeholder}
		</span>
	);
}

export function ModalCard({ title, subtitle, aside, children, className, width = 440 }: { title: string; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; width?: number }) {
	return (
		<div className={cx("rounded-[14px] border-[0.5px] border-gc-border bg-gc-surface p-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.6)]", className)} style={{ width }}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-[16px] font-semibold text-gc-text">{title}</div>
					{subtitle && <div className="mt-1 text-[12.5px] text-gc-text-dim">{subtitle}</div>}
				</div>
				{aside}
			</div>
			<div className="mt-4">{children}</div>
		</div>
	);
}

export function Avatar({ letter = "C", size = 28 }: { letter?: string; size?: number }) {
	return (
		<span
			className="inline-flex flex-none items-center justify-center rounded-lg border-[0.5px] border-gc-accent/40 bg-gc-accent/14 font-mono font-bold text-gc-accent"
			style={{ width: size, height: size, fontSize: size * 0.46 }}
		>
			{letter}
		</span>
	);
}

export function ToolTag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "error" }) {
	return (
		<span
			className={cx(
				"inline-flex items-center rounded px-[7px] py-0.5 font-sans text-[10.5px] font-semibold tracking-[0.4px] uppercase",
				tone === "error" ? "bg-gc-danger/14 text-gc-danger" : "bg-gc-surface-hi text-gc-text-dim",
			)}
		>
			{children}
		</span>
	);
}

export function ToolPill({ tag, summary, tone }: { tag: string; summary: string; tone?: "default" | "error" }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border-[0.5px] border-gc-border-soft bg-gc-surface-low px-3 py-2 font-mono text-[12.5px]">
			<ToolTag tone={tone}>{tag}</ToolTag>
			<span className="truncate text-gc-text-dim">{summary}</span>
		</div>
	);
}

export function ToolRunGroup({ count, names, thinking }: { count: number; names: string[]; thinking?: boolean }) {
	return (
		<div className="mb-3 flex items-center gap-2 pl-[42px] font-mono text-[12px] text-gc-text-faint">
			<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M3.5 2.5L6.5 5L3.5 7.5" />
			</svg>
			<span>{count} tool {count === 1 ? "call" : "calls"}</span>
			<span>·</span>
			<span className="text-gc-text-mute">
				{names.slice(0, 3).join(", ")}
				{names.length > 3 && ", …"}
				{thinking && " · thinking"}
			</span>
		</div>
	);
}

export function UserBubble({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cx("flex justify-end", className)}>
			<div className="max-w-[78%] rounded-[14px] border-[0.5px] border-gc-border bg-gc-surface px-4 py-3 text-[14px] leading-[1.55] text-gc-text">{children}</div>
		</div>
	);
}

export function AssistantMessage({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cx("flex gap-3.5", className)}>
			<Avatar />
			<div className="min-w-0 flex-1 text-[14px] leading-[1.6] text-gc-text">{children}</div>
		</div>
	);
}

export function Dot({ tone, size = 6, className }: { tone: string; size?: number; className?: string }) {
	return <span className={cx("inline-block flex-none rounded-full", tone, className)} style={{ width: size, height: size }} />;
}
