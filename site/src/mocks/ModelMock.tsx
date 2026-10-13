import { Lifted } from "../components/Lifted";
import { Btn, ModalCard } from "./atoms";
import { cx } from "../lib/cx";

const rows = [
	{ title: "Default", subtitle: "Sonnet 4.6" },
	{ title: "Opus", subtitle: "Opus 5.5" },
	{ title: "Sonnet", subtitle: "Sonnet 4.6", current: true },
	{ title: "Sonnet", subtitle: "Sonnet 4.6 with 1M context" },
	{ title: "Haiku", subtitle: "Haiku 4.5" },
	{ title: "Fable", subtitle: "Fable 5.1" },
];

export function ModelMock() {
	return (
		<div className="relative h-[500px] w-[560px]">
			<div className="absolute inset-x-8 top-5 flex items-center font-mono text-[11px] text-gc-text-mute opacity-60">
				<span className="text-gc-text-dim underline decoration-gc-text-faint underline-offset-2">Sonnet 4.6</span>
				<span className="ml-auto flex gap-4">
					<span>Input: <span className="text-gc-text-dim">12.3K tok</span></span>
					<span>Output: <span className="text-gc-text-dim">4.1K tok</span></span>
					<span>Context: <span className="text-gc-text-dim">87K tok</span></span>
				</span>
			</div>
			<Lifted className="absolute top-[52px] left-1/2 w-[456px] -translate-x-1/2">
				<ModalCard width={440} title="Model" subtitle="Applies to this session only. Picking a model stops the current response and continues with it automatically.">
					<div className="flex flex-col gap-1.5">
						{rows.map((r) => (
							<div
								key={r.title + r.subtitle}
								className={cx(
									"flex flex-col gap-0.5 rounded-lg border px-3 py-2",
									r.current ? "border-gc-accent/40 bg-gc-accent/14" : "border-gc-border-soft bg-gc-surface-low",
								)}
							>
								<span className="text-[13px] font-semibold text-gc-text">
									{r.title}
									{r.current && <span className="ml-2 text-[11px] font-normal text-gc-accent">current</span>}
								</span>
								<span className="text-[11px] text-gc-text-mute">{r.subtitle}</span>
							</div>
						))}
					</div>
					<div className="mt-4 flex justify-end">
						<Btn>Close</Btn>
					</div>
				</ModalCard>
			</Lifted>
		</div>
	);
}
