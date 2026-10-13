import { Lifted } from "../components/Lifted";
import { useInView } from "../lib/useInView";
import { cx } from "../lib/cx";
import { AssistantMessage, Btn, Kbd, StatusPill, UserBubble } from "./atoms";
import { Composer } from "./Composer";

export function SidequestMock() {
	const { ref, inView } = useInView<HTMLDivElement>(0.3);
	return (
		<div ref={ref} className="relative h-[540px] w-[760px] overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
			<div className="absolute inset-y-0 left-0 flex w-[470px] flex-col gap-5 px-7 pt-7 opacity-80">
				<UserBubble>Why does the retry queue drop jobs after a restart?</UserBubble>
				<AssistantMessage>
					<p>
						Jobs live only in memory. On restart the queue is rebuilt from the{" "}
						<span className="relative rounded-[3px] bg-gc-accent/25 px-0.5 text-gc-text">
							journal, but the journal is truncated by the compaction step
							<Kbd className="absolute -top-6 right-0 border-gc-accent/40 bg-gc-surface text-gc-accent shadow-[0_6px_18px_rgba(0,0,0,0.4)]">⌘S</Kbd>
						</span>{" "}
						before replay runs, so anything after the last checkpoint is gone.
					</p>
					<p className="mt-3">The fix is to run compaction after replay, not before. I'll make that change next.</p>
				</AssistantMessage>
				<div className="mt-auto pb-5">
					<Composer running placeholder="Reply to Claude…" />
				</div>
			</div>
			<Lifted
				className={cx(
					"absolute top-4 right-4 bottom-4 w-[318px] transition-all duration-700 ease-out",
					inView ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0",
				)}
			>
				<div className="flex h-full flex-col overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
					<div className="flex flex-col gap-2 px-4 pt-4 pb-3">
						<div className="flex items-center gap-2">
							<span className="text-[18px] font-semibold tracking-[-0.3px] text-gc-text">Sidequest</span>
							<span className="ml-auto flex items-center gap-1.5">
								<Btn size="sm">Clear</Btn>
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border-[0.5px] border-gc-border bg-gc-surface text-gc-text-dim">
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M4.5 2.5L8 6L4.5 9.5" />
									</svg>
								</span>
							</span>
						</div>
						<StatusPill status="running" />
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-3">
						<div className="flex justify-end">
							<div className="max-w-[92%] rounded-[12px] border-[0.5px] border-gc-border bg-gc-surface px-3 py-2.5 text-[12.5px] leading-[1.5] text-gc-text">
								<span className="text-gc-text-dim">"journal, but the journal is truncated by the compaction step"</span>
								<br />
								What is the journal here, in one line?
							</div>
						</div>
						<div className="flex gap-2.5">
							<span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md border-[0.5px] border-gc-accent/40 bg-gc-accent/14 font-mono text-[11px] font-bold text-gc-accent">C</span>
							<p className="text-[12.5px] leading-[1.55] text-gc-text">
								An append-only log of every job the queue accepted, written to disk so the queue can be rebuilt after a crash.
							</p>
						</div>
					</div>
					<div className="px-3 pb-3">
						<div className="mb-1.5 flex justify-between px-1 font-mono text-[10.5px] text-gc-text-mute">
							<span className="text-gc-text-dim">Sonnet 4.6</span>
							<span>Context: <span className="text-gc-text-dim">41K tok</span></span>
						</div>
						<Composer density="compact" placeholder="Ask a quick question…" />
					</div>
				</div>
			</Lifted>
		</div>
	);
}
