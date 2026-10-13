import type { ReactNode } from "react";
import { Lifted } from "../components/Lifted";
import { Btn, Dot, ModalCard, Segmented } from "./atoms";
import { SessionRow } from "./SessionRow";
import { cx } from "../lib/cx";

export function BabysitMock() {
	return (
		<div className="relative h-[520px] w-[620px]">
			<div className="absolute top-0 left-0 w-[300px] overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win opacity-60 [mask-image:linear-gradient(to_bottom,black_30%,transparent_85%)]">
				<SessionRow title="Migrate auth to sessions" summary="Asking to run the migration script." status="waiting for input" detail="Bash" babysit />
				<SessionRow title="Import legacy users" summary="Reading the CSV schema." status="running" babysit last />
			</div>
			<Lifted className="absolute top-8 right-0 w-[520px]">
				<ModalCard
					width={504}
					title="Babysitter"
					subtitle={<span className="text-gc-text-mute">Session: <span className="text-gc-text-dim">Migrate auth to sessions</span></span>}
					aside={
						<span className="inline-flex h-5 items-center gap-1.5 rounded-[10px] border-[0.5px] border-gc-babysit/40 bg-gc-babysit/14 px-2 text-[11px] font-medium text-gc-babysit">
							<Dot tone="bg-gc-babysit" size={5} />
							On
						</span>
					}
				>
					<div className="flex flex-col gap-2">
						<RuleCard title="Plan mode" armed>
							<Segmented options={["Do nothing", "Approve", "Deny"]} active="Approve" tones={{ "Approve": "text-gc-ok", "Deny": "text-gc-danger" }} />
						</RuleCard>
						<RuleCard title="Permission requests" armed>
							<Segmented options={["Do nothing", "Approve", "Deny"]} active="Approve" tones={{ "Approve": "text-gc-ok", "Deny": "text-gc-danger" }} />
						</RuleCard>
						<RuleCard
							title="Questions"
							armed
							message="I'm not here. Use your best judgement and keep going."
						>
							<Segmented options={["Do nothing", "Answer"]} active="Answer" tones={{ Answer: "text-gc-babysit" }} />
						</RuleCard>
					</div>
					<div className="mt-3 text-[11.5px] text-gc-warn">1 prompt is waiting right now and will be answered as soon as you save.</div>
					<div className="mt-4 flex items-center gap-2">
						<Btn className="text-gc-danger">Stop babysitting</Btn>
						<span className="ml-auto flex gap-2">
							<Btn>Cancel</Btn>
							<Btn tone="babysit">Save changes</Btn>
						</span>
					</div>
				</ModalCard>
			</Lifted>
		</div>
	);
}

function RuleCard({ title, armed, message, children }: { title: string; armed?: boolean; message?: string; children: ReactNode }) {
	return (
		<div className={cx("rounded-[10px] border-[0.5px] bg-gc-surface-low px-3 py-2.5", armed ? "border-gc-babysit/40" : "border-gc-border")}>
			<div className="flex items-center justify-between gap-3">
				<span className="text-[13px] font-semibold text-gc-text">{title}</span>
				{children}
			</div>
			{message && (
				<div className="mt-2.5 min-h-[52px] rounded-md border-[0.5px] border-gc-babysit/40 bg-gc-bg px-[9px] py-[7px] text-[13px] leading-[1.5] text-gc-text">{message}</div>
			)}
		</div>
	);
}
