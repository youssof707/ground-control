import { MockCanvas } from "./MockCanvas";
import { GitHubButton } from "./GitHubButton";
import { AppShellMock } from "../mocks/AppShellMock";

const chips = [
	{ label: "Babysitter", href: "#babysitter" },
	{ label: "Sidequest", href: "#sidequest" },
	{ label: "Inbox", href: "#inbox" },
	{ label: "Worktrees", href: "#worktrees" },
	{ label: "Groups", href: "#groups" },
	{ label: "Models", href: "#model" },
];

export function Hero() {
	return (
		<section id="top" className="relative overflow-x-clip pt-32 pb-10 lg:pt-40">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] blur-3xl"
				style={{ background: "radial-gradient(50% 55% at 50% 45%, oklch(0.76 0.10 250 / 0.16), transparent 70%)" }}
			/>
			<div className="mx-auto max-w-[80rem] px-6 lg:px-8">
				<div className="flex flex-col items-center text-center">
					<img src="/icon.png" alt="" width={64} height={64} className="h-16 w-16 rounded-[16px] shadow-[0_12px_32px_rgba(0,0,0,0.45)]" />
					<h1 className="mt-6 text-[clamp(2.25rem,4vw,3.25rem)] leading-[1.1] font-bold tracking-tight text-balance text-gc-text">
						Ground Control
					</h1>
					<p className="mt-4 max-w-[480px] text-[18px] leading-relaxed text-pretty text-gc-text-dim">
						A desktop app for running many Claude Code sessions side by side.
					</p>
					<div className="mt-8">
						<GitHubButton />
					</div>
				</div>
				<div className="mx-auto mt-16 max-w-[68rem] rounded-[26px] border border-white/10 bg-white/[0.03] p-2 backdrop-blur-xl sm:p-3 lg:mt-20">
					<div className="rounded-2xl border border-white/5 bg-gc-surface-low/80 p-1.5 sm:p-4">
						<MockCanvas width={1120} height={660}>
							<AppShellMock />
						</MockCanvas>
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
