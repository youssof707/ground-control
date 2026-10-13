import type { ReactNode } from "react";
import { Lifted } from "../components/Lifted";
import { Spinner } from "./atoms";
import { Composer } from "./Composer";

const tasks = [
	{ description: "Run the full test suite", kind: "shell", elapsed: "3m 12s" },
	{ description: "Review the auth module for unsafe redirects", kind: "agent", elapsed: "1m 48s" },
	{ description: "Build and sign the release DMG", kind: "shell", elapsed: "42s" },
	{ description: "Summarize changed files across the branch", kind: "workflow", elapsed: "1h 4m" },
];

export function TasksMock() {
	return (
		<div className="relative h-[460px] w-[640px]">
			<div className="absolute inset-x-6 bottom-0 opacity-75 [mask-image:linear-gradient(to_top,black_40%,transparent)]">
				<Composer running placeholder="Reply to Claude…" />
			</div>
			<div className="absolute right-6 bottom-[150px] flex items-center gap-2">
				<Chip>4 background tasks</Chip>
				<Chip>
					<Spinner />
					working 32s
					<span className="ml-1 opacity-60">×</span>
				</Chip>
			</div>
			<Lifted className="absolute top-2 right-6 w-[376px]">
				<div className="flex flex-col gap-2 rounded-[10px] border-[0.5px] border-gc-border bg-gc-surface p-2.5">
					{tasks.map((t) => (
						<div key={t.description} className="flex flex-col gap-1 rounded-[7px] border-[0.5px] border-gc-border-soft bg-gc-surface-low px-[9px] py-2">
							<div className="flex items-start justify-between gap-3">
								<span className="text-[12px] font-medium text-gc-text">{t.description}</span>
								<span className="text-[11px] font-medium text-gc-danger">Stop</span>
							</div>
							<span className="font-mono text-[11px] text-gc-text-mute">{t.kind} · {t.elapsed}</span>
						</div>
					))}
				</div>
			</Lifted>
		</div>
	);
}

function Chip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex h-[22px] items-center gap-1.5 rounded-[11px] border-[0.5px] border-[oklch(0.55_0.008_70/0.55)] bg-gc-surface px-[9px] font-mono text-[11.5px] tabular-nums text-[oklch(0.55_0.008_70)]">
			{children}
		</span>
	);
}
