export function Footer() {
	return (
		<footer className="border-t border-white/5 pt-12 pb-10">
			<div className="mx-auto flex max-w-[80rem] flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between lg:px-8">
				<div className="flex items-center gap-2.5">
					<img src="/icon.png" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-[6px] opacity-90" />
					<span className="text-[13px] font-semibold text-gc-text">Ground Control</span>
					<span className="text-[13px] text-gc-text-mute">A desktop app for Claude Code sessions.</span>
				</div>
				<div className="flex items-center gap-5 text-[13px] text-gc-text-mute">
					<a href="#" className="transition-colors hover:text-gc-text">GitHub</a>
					<a href="#" className="transition-colors hover:text-gc-text">Download</a>
					<span className="font-mono text-[11px] text-gc-text-faint">macOS · Apple Silicon</span>
				</div>
			</div>
		</footer>
	);
}
