import { Dot, Logo } from "./atoms";
import { cx } from "../lib/cx";

type Props = {
	running?: number;
	editing?: number;
	waiting?: number;
	inbox?: number;
	active?: "Notes" | "Sidequest" | "Inbox";
	sidequestLive?: "ok" | "warn";
	className?: string;
};

export function AppNavMock({ running = 0, editing = 0, waiting = 0, inbox = 0, active, sidequestLive, className }: Props) {
	return (
		<div className={cx("flex h-[52px] items-center gap-1 border-b-[0.5px] border-gc-border bg-gc-win px-[18px]", className)}>
			<Logo />
			<span className="mr-[18px] ml-2 text-[13.5px] font-semibold tracking-[-0.1px] text-gc-text">Ground Control</span>
			<span className="h-[18px] w-px bg-gc-border" />
			<div className="ml-3.5 flex items-center gap-3.5 text-[13px]">
				<Stat n={running} label="running" dot="bg-gc-ok" />
				<Sep />
				<Stat n={editing} label="editing" dot="bg-gc-accent" />
				<Sep />
				<Stat n={waiting} label="waiting" dot="bg-gc-warn" />
			</div>
			<div className="ml-auto flex items-center gap-1">
				<Toggle label="Notes" active={active === "Notes"} />
				<Toggle label="Sidequest" active={active === "Sidequest"} dot={sidequestLive} />
				<Toggle label="Inbox" active={active === "Inbox"} badge={inbox} />
			</div>
		</div>
	);
}

function Stat({ n, label, dot }: { n: number; label: string; dot: string }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			{n > 0 && <Dot tone={dot} />}
			<span className="font-mono font-medium text-gc-text">{n}</span>
			<span className="text-gc-text-mute">{label}</span>
		</span>
	);
}

function Sep() {
	return <span className="h-[3px] w-[3px] rounded-full bg-gc-border" />;
}

function Toggle({ label, active, dot, badge }: { label: string; active?: boolean; dot?: "ok" | "warn"; badge?: number }) {
	return (
		<span
			className={cx(
				"inline-flex items-center gap-[7px] rounded-lg px-3 py-1.5 text-[13px] font-medium",
				active ? "bg-gc-surface text-gc-text shadow-[inset_0_0_0_0.5px_var(--color-gc-border)]" : "text-gc-text-mute",
			)}
		>
			{dot && <Dot tone={dot === "ok" ? "bg-gc-ok" : "bg-gc-warn"} />}
			{label}
			{badge ? (
				<span className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-1.5 font-mono text-[11px] font-semibold", active ? "bg-gc-warn text-gc-accent-ink" : "bg-gc-warn/14 text-gc-warn")}>
					{badge}
				</span>
			) : null}
		</span>
	);
}
