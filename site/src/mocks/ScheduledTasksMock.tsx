import type { ReactNode } from "react";
import { Lifted } from "../components/Lifted";
import { Btn, Dot, Input, ModalCard, Segmented, Spinner } from "./atoms";
import { cx } from "../lib/cx";

type Row = { name: string; line: string; ago: string; tone?: string; running?: boolean; active?: boolean };

const rows: Row[] = [
	{ name: "Sentry triage", line: "2 new issues, fix PR opened", ago: "8m", tone: "bg-gc-warn" },
	{ name: "Dependency audit", line: "", ago: "", running: true, active: true },
	{ name: "Morning brief", line: "nothing to report", ago: "3h", tone: "bg-gc-ok" },
	{ name: "Nightly e2e", line: "checkout flow failing on Safari", ago: "9h", tone: "bg-gc-danger" },
];

export function ScheduledTasksMock() {
	return (
		<div className="relative h-[540px] w-[700px]">
			<div className="absolute top-8 left-0 w-[330px] rounded-lg border-[0.5px] border-gc-border bg-gc-win p-1 opacity-90 [mask-image:linear-gradient(to_right,black_55%,transparent)]">
				<div className="flex h-7 items-center gap-2 px-2 text-[13px] font-medium">
					<IconSlot>
						<ClockIcon />
					</IconSlot>
					<span className="text-gc-text">Tasks</span>
					<span className="-ml-0.5 font-mono text-[11px] text-gc-text-mute">4</span>
				</div>
				{rows.map((r) => (
					<div
						key={r.name}
						className={cx("flex h-7 items-center gap-2 rounded-[5px] px-2 text-[12px] text-gc-text-mute", r.active && "bg-gc-surface-hi")}
					>
						<IconSlot>{r.running ? <Spinner /> : <Dot tone={r.tone ?? "bg-gc-text-faint"} />}</IconSlot>
						<span className={cx("max-w-[40%] flex-none truncate", r.active ? "text-gc-text" : "text-gc-text-dim")}>{r.name}</span>
						<span className="min-w-0 flex-1 truncate">{r.line}</span>
						<span className="min-w-[22px] text-right font-mono text-[10.5px] text-gc-text-faint">{r.ago}</span>
					</div>
				))}
			</div>
			<Lifted className="absolute top-0 right-0 w-[436px]">
				<ModalCard width={420} title="Edit task">
					<div className="flex flex-col gap-3">
						<Field label="Name (optional)">
							<Input value="Sentry triage" />
						</Field>
						<Field label="Prompt">
							<span className="flex h-[58px] items-start rounded-md border-[0.5px] border-gc-border bg-gc-surface-low px-[9px] py-[7px] text-[12.5px] leading-[1.45] text-gc-text">
								Triage every Sentry issue from the last 24 hours and open one PR with the fixes.
							</span>
						</Field>
						<Field label="Folder">
							<Input value="~/code/billing-service" mono />
						</Field>
						<Field label="When">
							<div className="flex items-center gap-2">
								<Segmented options={["Once", "Every", "Daily"]} active="Daily" />
								<span className="text-[12.5px] text-gc-text-dim">at</span>
								<Input value="9:00 AM" className="w-[84px]" />
							</div>
						</Field>
						<Field label="Always show status">
							<Switch on />
						</Field>
					</div>
					<div className="mt-5 flex justify-end gap-2 border-t-[0.5px] border-gc-border-soft pt-3.5">
						<Btn>Cancel</Btn>
						<Btn tone="primary">Save</Btn>
					</div>
				</ModalCard>
			</Lifted>
		</div>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[11.5px] font-medium text-gc-text-dim">{label}</span>
			{children}
		</div>
	);
}

function Switch({ on }: { on?: boolean }) {
	return (
		<span className={cx("relative inline-flex h-[18px] w-[30px] rounded-full", on ? "bg-gc-accent" : "bg-gc-surface-hi")}>
			<span className={cx("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-gc-text", on ? "left-[14px]" : "left-[2px]")} />
		</span>
	);
}

function IconSlot({ children }: { children: ReactNode }) {
	return <span className="inline-flex w-3.5 flex-none items-center justify-center">{children}</span>;
}

function ClockIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="text-gc-text-dim">
			<circle cx="7" cy="7" r="5.5" />
			<path d="M7 4v3l2 1.5" />
		</svg>
	);
}
