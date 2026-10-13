import type { ReactNode } from "react";
import { Lifted } from "../components/Lifted";
import { BranchChip, Btn, XIcon } from "./atoms";
import { cx } from "../lib/cx";

export function InboxMock() {
	return (
		<div className="relative h-[560px] w-[640px]">
			<Lifted className="absolute top-2 left-1/2 w-[440px] -translate-x-1/2">
				<div className="overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
					<div className="flex items-start justify-between px-5 pt-5 pb-4">
						<div>
							<div className="text-[11.5px] font-semibold tracking-[1px] text-gc-text-mute uppercase">Awaiting your input</div>
							<div className="mt-1 text-[20px] font-semibold tracking-[-0.3px] text-gc-text">Inbox</div>
							<div className="mt-1 text-[12.5px] text-gc-text-dim">3 pending · sessions pause until you respond.</div>
						</div>
						<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border-[0.5px] border-gc-border bg-gc-surface text-gc-text-dim"><XIcon /></span>
					</div>
					<div className="flex flex-col gap-3.5 px-4 pb-6">
						<InboxCard from="Migrate auth to sessions" branch="feat/auth-sessions" time="14:02">
							<div className="flex items-center gap-2.5">
								<span className="flex h-[22px] w-[22px] items-center justify-center rounded-md border-[0.5px] border-gc-warn/40 bg-gc-warn/14 text-[12px]">🔧</span>
								<span className="text-[12.5px] text-gc-text-dim">Tool request:</span>
								<span className="font-mono text-[12.5px] font-bold text-gc-text">Bash</span>
							</div>
							<div className="mt-2.5 rounded-lg border-[0.5px] border-gc-border-soft bg-gc-surface-low px-3 py-2 font-mono text-[12px] text-gc-text-dim">npm run migrate -- --to sessions</div>
							<div className="mt-3 flex justify-end gap-2">
								<Btn size="sm">Deny…</Btn>
								<Btn size="sm">Deny</Btn>
								<Btn size="sm" tone="warn">Allow</Btn>
								<Btn size="sm" tone="warn">Always allow Bash</Btn>
							</div>
						</InboxCard>
						<InboxCard from="Rate limit middleware" branch="feat/ratelimit" time="13:48">
							<div className="rounded-xl border-[1.5px] border-gc-warn p-3.5" style={{ boxShadow: "0 0 0 3px oklch(0.75 0.15 60 / 0.14)" }}>
								<div className="text-[11px] font-semibold tracking-[0.5px] text-gc-warn uppercase">Plan ready for review</div>
								<div className="mt-1.5 text-[12.5px] leading-[1.5] text-gc-text-dim">
									Approving will switch this session to <span className="font-semibold text-gc-text">Auto-edit</span> mode so Claude can apply the plan.
								</div>
								<div className="mt-3 flex flex-col gap-1 text-[12.5px] text-gc-text">
									<div className="font-semibold">Add a token-bucket middleware</div>
									<div className="text-gc-text-dim">1. New <span className="font-mono text-[12px]">rateLimit.ts</span> with per-key buckets</div>
									<div className="text-gc-text-dim">2. Register it before the auth handler</div>
								</div>
								<div className="mt-3 flex justify-end gap-2">
									<Btn size="sm">Stop</Btn>
									<Btn size="sm">Keep planning</Btn>
									<Btn size="sm" tone="warn">Approve & start editing</Btn>
								</div>
							</div>
						</InboxCard>
						<InboxCard from="Settings page redesign" branch="feat/settings" time="13:31" className="opacity-80 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
							<div className="flex items-center gap-2">
								<span className="text-[12.5px] font-medium text-gc-text">Claude is asking</span>
								<span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium text-gc-warn bg-gc-warn/14">Layout</span>
							</div>
							<div className="mt-2 text-[14.5px] font-medium text-gc-text">Which side should the section list go on?</div>
							<div className="mt-2.5 flex flex-col gap-1.5">
								<Option selected>Left, like the sidebar</Option>
								<Option>Right</Option>
							</div>
						</InboxCard>
					</div>
				</div>
			</Lifted>
		</div>
	);
}

function InboxCard({ from, branch, time, children, className }: { from: string; branch: string; time: string; children: ReactNode; className?: string }) {
	return (
		<div className={cx("rounded-xl border-[0.5px] border-gc-border bg-gc-surface", className)}>
			<div className="flex items-center gap-2 border-b-[0.5px] border-gc-border px-3.5 py-2.5">
				<span className="text-[12px] text-gc-text-dim">From</span>
				<span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-gc-warn">
					{from}
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
						<path d="M3 2h5v5M3 7l5-5" />
					</svg>
				</span>
				<span className="ml-auto"><BranchChip name={branch} /></span>
				<span className="font-mono text-[11.5px] text-gc-text-faint">{time}</span>
			</div>
			<div className="p-3.5">{children}</div>
		</div>
	);
}

function Option({ children, selected }: { children: ReactNode; selected?: boolean }) {
	return (
		<div className={cx("flex items-center gap-2.5 rounded-lg border-[0.5px] px-3 py-2 text-[12.5px]", selected ? "border-gc-warn/40 bg-gc-warn/14 text-gc-text" : "border-gc-border bg-gc-surface-low text-gc-text-dim")}>
			<span className={cx("h-3 w-3 rounded-full border-[1.5px]", selected ? "border-gc-warn bg-gc-warn" : "border-gc-border")} />
			{children}
		</div>
	);
}
