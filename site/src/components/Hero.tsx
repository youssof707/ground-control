import { MockCanvas } from "./MockCanvas";
import { AppShellMock } from "../mocks/AppShellMock";

const chips = [
	{ label: "Sidequest", href: "#sidequest" },
	{ label: "Inbox", href: "#inbox" },
	{ label: "Babysitter", href: "#babysitter" },
	{ label: "Worktrees", href: "#worktrees" },
	{ label: "Groups", href: "#groups" },
	{ label: "Models", href: "#model" },
];

export function Hero() {
	return (
		<section id="top" className="relative overflow-x-clip pt-32 pb-10 lg:pt-40">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] blur-3xl"
				style={{ background: "radial-gradient(50% 60% at 70% 30%, oklch(0.76 0.10 250 / 0.18), transparent 70%)" }}
			/>
			<div className="mx-auto max-w-[80rem] px-6 lg:px-8">
				<div className="grid items-center gap-10 lg:grid-cols-[minmax(300px,0.9fr)_1.6fr] lg:gap-14">
					<div className="flex flex-col items-start">
						<div className="flex items-center gap-3">
							<img src="/icon.png" alt="" width={56} height={56} className="h-14 w-14 rounded-[14px] shadow-[0_12px_32px_rgba(0,0,0,0.45)]" />
						</div>
						<h1 className="mt-6 max-w-[460px] text-[clamp(2.25rem,3.1vw,2.75rem)] leading-[1.14] font-bold tracking-tight text-balance text-gc-text">
							Ground Control
						</h1>
						<p className="mt-4 max-w-[420px] text-[18px] leading-relaxed text-pretty text-gc-text-dim">
							A desktop app for running many Claude Code sessions side by side.
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-3">
							<a
								href="#"
								className="group inline-flex h-12 items-center gap-1.5 rounded-[14px] bg-gc-text px-5 text-[15px] font-semibold text-gc-accent-ink transition-colors hover:bg-gc-accent"
							>
								Download for macOS
								<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
							</a>
							<a
								href="#"
								className="inline-flex h-12 items-center gap-1.5 rounded-[14px] border border-white/[0.18] bg-white/[0.12] px-5 text-[15px] font-medium text-gc-text backdrop-blur-md transition-colors hover:bg-white/[0.2]"
							>
								View on GitHub
							</a>
						</div>
						<p className="mt-4 font-mono text-[11.5px] text-gc-text-faint">macOS · Apple Silicon · Free</p>
					</div>
					<div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-2 backdrop-blur-xl sm:p-3">
						<div className="rounded-2xl border border-white/5 bg-gc-surface-low/80 p-1.5 sm:p-3">
							<MockCanvas width={960} height={600}>
								<AppShellMock />
							</MockCanvas>
						</div>
					</div>
				</div>
				<div className="mt-14 flex flex-wrap items-center justify-center gap-2.5">
					{chips.map((c) => (
						<a
							key={c.label}
							href={c.href}
							className="rounded-xl border border-white/10 px-4 py-2 text-[13.5px] font-semibold text-gc-text-mute transition-all hover:border-white/20 hover:text-gc-text"
						>
							{c.label}
						</a>
					))}
				</div>
			</div>
		</section>
	);
}
