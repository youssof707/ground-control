import type { ReactNode } from "react";
import { Lifted } from "../components/Lifted";
import { Btn, Dot, PlusIcon, XIcon } from "./atoms";
import { cx } from "../lib/cx";

type Row = { name: string; count?: number; line: string; tone: string; active?: boolean };

const rows: Row[] = [
	{ name: "web", count: 2, line: "➜ Local: http://localhost:5173/", tone: "bg-gc-ok", active: true },
	{ name: "billing-service", line: "listening on :8080", tone: "bg-gc-ok" },
	{ name: "ground-control", line: "", tone: "bg-gc-text-faint" },
	{ name: "worker", line: "Error: connect ECONNREFUSED 127.0.0.1:6379", tone: "bg-gc-danger" },
];

const devPane = [
	{ text: "~/code/web $ npm run dev", tone: "text-gc-text" },
	{ text: "", tone: "" },
	{ text: "  VITE v7.1.2  ready in 412 ms", tone: "text-gc-ok" },
	{ text: "", tone: "" },
	{ text: "  ➜  Local:   http://localhost:5173/", tone: "text-gc-text-dim" },
	{ text: "  ➜  Network: use --host to expose", tone: "text-gc-text-mute" },
	{ text: "", tone: "" },
	{ text: "  10:42:07 [vite] hmr update /src/App.tsx", tone: "text-gc-text-mute" },
];

const testPane = [
	{ text: "~/code/web $ npm test -- --watch", tone: "text-gc-text" },
	{ text: "", tone: "" },
	{ text: " ✓ src/cart.test.ts (12 tests) 38ms", tone: "text-gc-ok" },
	{ text: " ✓ src/checkout.test.ts (7 tests) 61ms", tone: "text-gc-ok" },
	{ text: " ✓ src/auth.test.ts (9 tests) 22ms", tone: "text-gc-ok" },
	{ text: "", tone: "" },
	{ text: " Tests  28 passed (28)", tone: "text-gc-text-dim" },
	{ text: " Waiting for file changes…", tone: "text-gc-text-mute" },
];

export function TerminalsMock() {
	return (
		<div className="relative h-[540px] w-[760px]">
			<div className="absolute bottom-6 left-0 w-[330px] rounded-lg border-[0.5px] border-gc-border bg-gc-win p-1 opacity-90 [mask-image:linear-gradient(to_right,black_55%,transparent)]">
				<div className="flex h-7 items-center gap-2 pr-1 pl-2 text-[13px] font-medium">
					<IconSlot>
						<TerminalIcon />
					</IconSlot>
					<span className="text-gc-text">Terminals</span>
					<span className="-ml-0.5 font-mono text-[11px] text-gc-text-mute">4</span>
					<span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-gc-text-dim">
						<PlusIcon size={10} />
						Add Terminal
					</span>
				</div>
				{rows.map((r) => (
					<div
						key={r.name}
						className={cx("flex h-7 items-center gap-2 rounded-[5px] px-2 text-[12px] text-gc-text-mute", r.active && "bg-gc-surface-hi")}
					>
						<IconSlot>
							<Dot tone={r.tone} />
						</IconSlot>
						<span className={cx("max-w-[40%] flex-none truncate", r.active ? "text-gc-text" : "text-gc-text-dim")}>{r.name}</span>
						{r.count ? <span className="-ml-1 font-mono text-[11px]">{r.count}</span> : null}
						<span className="min-w-0 flex-1 truncate font-mono text-[11px]">{r.line}</span>
					</div>
				))}
			</div>
			<Lifted className="absolute top-0 right-0 w-[600px]">
				<div className="overflow-hidden rounded-[14px] border-[0.5px] border-gc-border bg-gc-surface shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
					<div className="flex h-11 items-center gap-2 border-b-[0.5px] border-gc-border-soft px-3.5">
						<Dot tone="bg-gc-ok" size={7} />
						<span className="text-[13.5px] font-semibold text-gc-text">web</span>
						<span className="font-mono text-[11px] text-gc-text-mute">~/code/web</span>
						<div className="ml-auto flex items-center gap-1.5">
							<Btn size="sm" tone="ghost">Load Config</Btn>
							<Btn size="sm" tone="ghost">Save Config</Btn>
							<Btn size="sm">Split</Btn>
							<span className="ml-1 inline-flex h-6 w-6 items-center justify-center text-gc-text-mute">
								<XIcon size={11} />
							</span>
						</div>
					</div>
					<div className="grid h-[300px] grid-cols-2 gap-px bg-gc-border-soft">
						<Pane lines={devPane} focused />
						<Pane lines={testPane} />
					</div>
				</div>
			</Lifted>
		</div>
	);
}

function Pane({ lines, focused }: { lines: Array<{ text: string; tone: string }>; focused?: boolean }) {
	return (
		<div className={cx("flex flex-col bg-gc-bg px-3 py-2.5 font-mono text-[11px] leading-[1.6]", focused && "shadow-[inset_0_0_0_1px_var(--color-gc-accent)]")}>
			{lines.map((l, i) => (
				<span key={i} className={cx("min-h-[1.6em] whitespace-pre", l.tone)}>
					{l.text}
				</span>
			))}
			{focused ? null : <span className="mt-0.5 inline-block h-[13px] w-[7px] bg-gc-text-dim" />}
		</div>
	);
}

function IconSlot({ children }: { children: ReactNode }) {
	return <span className="inline-flex w-3.5 flex-none items-center justify-center">{children}</span>;
}

function TerminalIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-gc-text-dim">
			<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
			<path d="M4 6l2 1.5L4 9M7.5 9H10" />
		</svg>
	);
}
