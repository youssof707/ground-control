import { Lifted } from "../components/Lifted";
import { Btn, Input, ModeToggle, Segmented, Spinner } from "./atoms";
import { cx } from "../lib/cx";

const skills = ["/code-review", "/simplify", "/security-review", "/dataviz", "/deep-research", "/init"];

export function SkillsMock() {
	return (
		<div className="relative h-[480px] w-[680px]">
			<Lifted className="absolute top-0 left-0 w-[420px]">
				<div className="rounded-[14px] border-[0.5px] border-gc-border bg-gc-surface p-[22px]">
					<div className="flex items-center justify-between gap-3">
						<span className="flex items-center gap-2 text-[16px] font-semibold text-gc-text">
							Shortcuts & skills
							<span className="text-gc-text-faint"><Spinner size={10} /></span>
						</span>
						<Segmented options={["Shortcuts", "Skills"]} active="Skills" />
					</div>
					<Input placeholder="Search skills…" className="mt-4" />
					<div className="mt-2 flex min-h-[180px] flex-col gap-px">
						{skills.map((s, i) => (
							<div key={s} className={cx("rounded-md px-[9px] py-1.5 font-mono text-[12.5px] font-medium", i === 1 ? "bg-gc-accent/14 text-gc-text" : "text-gc-text-dim")}>
								{s}
							</div>
						))}
					</div>
					<div className="mt-3 flex justify-end border-t-[0.5px] border-gc-border-soft pt-3">
						<Btn>Open skills folder</Btn>
					</div>
				</div>
			</Lifted>
			<Lifted className="absolute right-0 bottom-0 w-[340px]">
				<div className="rounded-[14px] border-[0.5px] border-gc-border bg-gc-surface p-[22px]">
					<div className="text-[16px] font-semibold text-gc-text">Create shortcut</div>
					<label className="mt-4 block text-[11px] text-gc-text-dim">Name</label>
					<Input value="Ship it" className="mt-1" />
					<label className="mt-3 block text-[11px] text-gc-text-dim">Prompt</label>
					<div className="mt-1 min-h-[76px] rounded-md border-[0.5px] border-gc-border bg-gc-surface-low px-[9px] py-1.5 text-[13px] leading-[1.5] text-gc-text">
						Run typecheck and lint, fix anything they report, then commit with a one-line message.
					</div>
					<div className="mt-3 flex items-center justify-between">
						<span className="text-[11px] text-gc-text-dim">Mode</span>
						<ModeToggle mode="Auto-edit" />
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<Btn size="sm">Cancel</Btn>
						<Btn size="sm" tone="primary">Create</Btn>
					</div>
				</div>
			</Lifted>
		</div>
	);
}
