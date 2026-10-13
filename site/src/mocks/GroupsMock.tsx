import { Lifted } from "../components/Lifted";
import { Btn, Dot, Eyebrow, Input, ModalCard } from "./atoms";
import { SectionHeader, SessionRow, Well } from "./SessionRow";
import { cx } from "../lib/cx";

export function GroupsMock() {
	return (
		<div className="relative h-[500px] w-[600px]">
			<div className="absolute top-0 left-0 w-[320px] overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
				<Well className="mt-0 border-t-0">
					<SectionHeader name="payments" tone="info" open />
					<SessionRow title="Stripe webhook retries" summary="Added idempotency keys. Tests pass." status="done" branch="main" />
					<SessionRow title="Refund flow" summary="Reading the existing handler." status="running" last />
				</Well>
				<Well>
					<SectionHeader name="hotfix" tone="danger" badges={{ waiting: 1, running: 2 }} />
				</Well>
				<Well>
					<SectionHeader name="ground-control" badges={{ running: 1 }} />
				</Well>
				<SessionRow title="Docs cleanup" summary="Rewrote the README install section." status="idle" last />
			</div>
			<Lifted className="absolute top-[150px] right-0 w-[330px]">
				<ModalCard width={314} title="Add to group">
					<Eyebrow className="mb-2">Existing groups</Eyebrow>
					<div className="flex flex-col gap-1.5">
						<GroupRow name="payments" tone="bg-gc-info" sessions={2} />
						<GroupRow name="hotfix" tone="bg-gc-danger" sessions={3} />
					</div>
					<Eyebrow className="mt-4 mb-2">Or create a new group</Eyebrow>
					<Input value="infra" />
					<div className="mt-2.5 flex items-center gap-2.5">
						<span className="text-[11px] text-gc-text-dim">Color</span>
						<Swatch tone="bg-gc-info" fg="oklch(0.80 0.09 210)" />
						<Swatch tone="bg-gc-danger" fg="oklch(0.70 0.18 25)" selected />
						<Swatch tone="bg-gc-text-mute" fg="oklch(0.56 0.010 70)" />
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<Btn size="sm">Cancel</Btn>
						<Btn size="sm" tone="primary">Create & add</Btn>
					</div>
				</ModalCard>
			</Lifted>
		</div>
	);
}

function GroupRow({ name, tone, sessions }: { name: string; tone: string; sessions: number }) {
	return (
		<div className="flex items-center gap-2.5 rounded-lg border-[0.5px] border-gc-border bg-gc-surface px-2.5 py-2">
			<Dot tone={tone} size={8} />
			<span className="text-[12.5px] font-semibold text-gc-text">{name}</span>
			<span className="ml-auto text-[11px] text-gc-text-mute">{sessions} sessions</span>
		</div>
	);
}

function Swatch({ tone, fg, selected }: { tone: string; fg: string; selected?: boolean }) {
	return (
		<span
			className={cx("h-4 w-4 rounded-full", tone)}
			style={selected ? { boxShadow: `0 0 0 2px var(--color-gc-win), 0 0 0 3.5px ${fg}` } : undefined}
		/>
	);
}
