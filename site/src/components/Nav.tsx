import { useEffect, useState } from "react";
import { cx } from "../lib/cx";

export function Nav() {
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 24);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<header
			className={cx(
				"fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
				scrolled ? "border-white/10 bg-gc-bg/80 backdrop-blur-xl" : "border-transparent bg-transparent",
			)}
		>
			<nav className="mx-auto flex h-16 max-w-[80rem] items-center justify-between gap-4 px-6 lg:px-8">
				<a href="#top" className="flex items-center gap-2.5">
					<img src="/icon.png" alt="" width={26} height={26} className="h-[26px] w-[26px] rounded-[7px]" />
					<span className="text-[14px] font-semibold tracking-[-0.01em] text-gc-text">Ground Control</span>
				</a>
				<div className="flex items-center gap-1">
					<a
						href="#overview"
						className="rounded-xl px-2.5 py-1.5 text-[14px] font-medium text-gc-text-dim transition-colors hover:bg-white/5 hover:text-gc-text"
					>
						Features
					</a>
					<a
						href="#"
						className="rounded-xl px-2.5 py-1.5 text-[14px] font-medium text-gc-text-dim transition-colors hover:bg-white/5 hover:text-gc-text"
					>
						GitHub
					</a>
					<a
						href="#"
						className="group ml-2 inline-flex items-center gap-1.5 rounded-xl bg-gc-text px-4 py-2 text-[14px] font-semibold text-gc-accent-ink transition-colors hover:bg-gc-accent"
					>
						Download
						<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
					</a>
				</div>
			</nav>
		</header>
	);
}
