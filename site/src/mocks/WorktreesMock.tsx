import { Lifted } from "../components/Lifted";
import { Btn, Dot, Eyebrow, ModalCard } from "./atoms";
import { cx } from "../lib/cx";

type Row = { name: string; branch: string; sessions: number; tone: "info" | "danger" | "neutral"; confirm?: boolean };

const repos: Array<{ folder: string; rows: Row[] }> = [
	{
		folder: "ground-control",
		rows: [
			{ name: "Settings redesign", branch: "feat/settings", sessions: 2, tone: "info" },
			{ name: "Upload hotfix", branch: "fix/upload-retry", sessions: 1, tone: "danger" },
			{ name: "Docs", branch: "chore/docs", sessions: 0, tone: "neutral", confirm: true },
		],
	},
	{
		folder: "billing-service",
		rows: [
			{ name: "Webhook retries", branch: "feat/webhook-retries", sessions: 1, tone: "info" },
			{ name: "Refunds", branch: "feat/refunds", sessions: 1, tone: "neutral" },
		],
	},
];

const dotTone = { info: "bg-gc-info", danger: "bg-gc-danger", neutral: "bg-gc-text-mute" };
const chipTone = {
	info: "border-gc-info/30 bg-gc-info/14 text-gc-info",
	danger: "border-gc-danger/40 bg-gc-danger/14 text-gc-danger",
	neutral: "border-gc-neutral/40 bg-gc-neutral/14 text-gc-text-mute",
};

export function WorktreesMock() {
	return (
		<div className="relative h-[480px] w-[620px]">
			<div className="absolute top-6 left-0 flex w-[250px] flex-col gap-2 opacity-70 [mask-image:linear-gradient(to_right,black_40%,transparent)]">
				{repos[0].rows.map((r) => (
					<div key={r.name} className="flex items-center gap-2 rounded-lg border-[0.5px] border-gc-border-soft bg-gc-win px-3 py-2.5">
						<span className="truncate text-[13px] font-medium text-gc-text">{r.name}</span>
						<WorktreeChip name={r.name} tone={r.tone} />
					</div>
				))}
			</div>
			<Lifted className="absolute top-0 right-0 w-[520px]">
				<ModalCard width={504} title="Worktrees">
					<div className="flex flex-col gap-3.5">
						{repos.map((repo) => (
							<div key={repo.folder}>
								<Eyebrow className="mb-2">{repo.folder}</Eyebrow>
								<div className="flex flex-col gap-1">
									{repo.rows.map((r) => (
										<div key={r.name} className="flex h-9 items-center gap-2.5 rounded-lg border-[0.5px] border-gc-border bg-gc-surface py-1.5 pr-1.5 pl-2.5 text-[12.5px]">
											<Dot tone={dotTone[r.tone]} size={8} />
											<span className="flex-1 font-semibold text-gc-text">{r.name}</span>
											<span className="max-w-[200px] truncate font-mono text-[11px] text-gc-text-dim">{r.branch}</span>
											<span className="text-[11px] text-gc-text-mute">{r.sessions} {r.sessions === 1 ? "session" : "sessions"}</span>
											{r.confirm ? (
												<span className="inline-flex items-center rounded-md border-[0.5px] border-gc-danger/40 bg-gc-danger/14 px-2.5 py-1 text-[11.5px] font-medium text-gc-danger">Confirm delete?</span>
											) : r.sessions === 0 ? (
												<span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gc-text-mute"><TrashIcon /></span>
											) : (
												<span className="w-6" />
											)}
										</div>
									))}
								</div>
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

export function WorktreeChip({ name, tone }: { name: string; tone: "info" | "danger" | "neutral" }) {
	return (
		<span className={cx("inline-flex h-[22px] max-w-[200px] items-center gap-1.5 rounded-[11px] border-[0.5px] pr-[9px] pl-2 text-[11.5px] font-medium", chipTone[tone])}>
			<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
				<path d="M1.5 3.5V9a1 1 0 0 0 1 1H8" />
				<path d="M3.5 5.5V2.5h2l1 1h4v6.5" />
			</svg>
			<span className="truncate">{name}</span>
		</span>
	);
}

function TrashIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.6 7.5h5.8L10.5 4" />
		</svg>
	);
}
