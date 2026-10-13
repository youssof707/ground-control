import { Lifted } from "../components/Lifted";
import { Dot } from "./atoms";
import { Composer } from "./Composer";

export function TokensMock() {
	return (
		<div className="relative h-[380px] w-[640px]">
			<div className="absolute inset-x-6 top-0 opacity-70 [mask-image:linear-gradient(to_top,black_40%,transparent)]">
				<Composer value="Also update the migration docs once the script is green." />
			</div>
			<Lifted className="absolute inset-x-10 bottom-[108px]">
				<div className="rounded-xl border-[0.5px] border-gc-border bg-gc-win px-4 pt-3 pb-3.5">
					<div className="flex items-center font-mono text-[11px] text-gc-text-mute">
						<span className="text-gc-text-dim underline decoration-gc-text-faint underline-offset-2">Sonnet 4.6</span>
						<span className="ml-auto flex gap-4">
							<span>Input: <span className="text-gc-text-dim">12.3K tok</span></span>
							<span>Output: <span className="text-gc-text-dim">4.1K tok</span></span>
							<span>Context: <span className="text-gc-text-dim">87K tok</span></span>
						</span>
					</div>
					<div className="mt-2.5 h-1 overflow-hidden rounded-full bg-gc-surface-hi">
						<div className="h-full w-[43%] animate-fill rounded-full bg-gc-accent" />
					</div>
					<div className="mt-1.5 flex justify-between font-mono text-[10px] text-gc-text-faint">
						<span>87K of 200K context</span>
						<span>43%</span>
					</div>
				</div>
			</Lifted>
			<Lifted className="absolute right-10 bottom-0 w-[300px]">
				<div className="rounded-xl border-[0.5px] border-gc-border bg-gc-win px-3.5 py-3">
					<div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2px] text-gc-text-faint">
						<Dot tone="bg-gc-warn" />
						Usage resets in 4h 12m - 82% used
					</div>
					<div className="mt-2 h-1 overflow-hidden rounded-full bg-gc-surface-hi">
						<div className="h-full w-[82%] animate-fill rounded-full bg-gc-warn" />
					</div>
				</div>
			</Lifted>
		</div>
	);
}
