import { ArrowIcon, BoltIcon, Btn, IconBtn, MicIcon, ModeToggle } from "./atoms";
import { cx } from "../lib/cx";

type Props = {
	density?: "full" | "compact";
	placeholder?: string;
	value?: string;
	mode?: "Plan" | "Auto-edit";
	running?: boolean;
	queued?: string;
	className?: string;
};

export function Composer({ density = "full", placeholder = "Reply to Claude…", value, mode = "Plan", running, queued, className }: Props) {
	const full = density === "full";
	return (
		<div
			className={cx(
				"border-[0.5px] border-gc-border",
				full ? "rounded-xl bg-gc-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.25)]" : "rounded-[10px] bg-gc-surface-low p-2.5",
				className,
			)}
		>
			{queued && (
				<div className="mb-2.5 flex gap-1.5">
					<span className="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] border-[0.5px] border-gc-border bg-gc-surface-hi pr-1 pl-2 text-[11.5px] text-gc-text-dim">
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
							<circle cx="5" cy="5" r="4" />
							<path d="M5 2.6V5l1.8 1.2" />
						</svg>
						<span className="max-w-[260px] truncate">{queued}</span>
						<span className="px-1 opacity-60">×</span>
					</span>
				</div>
			)}
			<div className={cx("min-h-[44px] leading-[1.5]", full ? "text-[14px]" : "text-[13px]", value ? "text-gc-text" : "text-gc-text-faint")}>{value ?? placeholder}</div>
			<div className="mt-2.5 flex items-center justify-end gap-2 border-t-[0.5px] border-gc-border-soft pt-2.5">
				<IconBtn><BoltIcon /></IconBtn>
				<IconBtn><MicIcon /></IconBtn>
				<ModeToggle mode={mode} />
				{running ? (
					<span className="inline-flex h-8 items-stretch rounded-lg bg-gc-accent text-[13px] font-medium text-gc-accent-ink">
						<span className="inline-flex items-center gap-1.5 rounded-l-lg px-3.5 opacity-55">Send <ArrowIcon /></span>
						<span className="inline-flex w-[26px] items-center justify-center border-l border-[rgba(26,20,16,0.22)]">
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
								<path d="M2.5 7L6 3.5 9.5 7" />
							</svg>
						</span>
					</span>
				) : (
					<Btn tone="primary">Send <ArrowIcon /></Btn>
				)}
			</div>
		</div>
	);
}
