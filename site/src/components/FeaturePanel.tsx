import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { Glow, type GlowTrio } from "./Glow";
import { MockCanvas } from "./MockCanvas";
import { cx } from "../lib/cx";

type Props = {
	id: string;
	lead: string;
	body: string;
	bullets?: string[];
	hint?: ReactNode;
	flip?: boolean;
	glow: GlowTrio;
	canvas: { width: number; height: number };
	stageClassName?: string;
	children: ReactNode;
};

export function FeaturePanel({ id, lead, body, bullets, hint, flip, glow, canvas, stageClassName, children }: Props) {
	const panel = useRef<HTMLDivElement>(null);

	const track = useCallback((e: PointerEvent<HTMLDivElement>) => {
		const node = panel.current;
		if (!node) return;
		const rect = node.getBoundingClientRect();
		node.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
		node.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
		node.style.setProperty("--glow", "1");
	}, []);

	const rest = useCallback(() => {
		panel.current?.style.setProperty("--glow", "0.55");
	}, []);

	return (
		<section
			id={id}
			ref={panel}
			onPointerMove={track}
			onPointerLeave={rest}
			className="relative -mx-3 overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl sm:mx-0 sm:p-5 lg:p-9"
		>
			<Glow trio={glow} />
			<div
				className={cx(
					"relative z-10 grid items-start gap-6 sm:gap-9 lg:items-stretch",
					flip ? "lg:grid-cols-[minmax(280px,1fr)_1.5fr]" : "lg:grid-cols-[1.5fr_minmax(280px,1fr)]",
				)}
			>
				<div className={cx("flex min-w-0 flex-col justify-center", flip ? "lg:order-2" : "lg:order-1")}>
					<div
						className={cx(
							"flex flex-col justify-center rounded-2xl border border-white/5 bg-gc-surface-low/80 p-1.5 shadow-sm sm:p-3 lg:min-h-[560px] lg:p-6",
							stageClassName,
						)}
					>
						<MockCanvas width={canvas.width} height={canvas.height}>{children}</MockCanvas>
					</div>
				</div>
				<div className={cx("flex min-w-0 flex-col pb-3 lg:pb-0", flip ? "lg:order-1" : "lg:order-2")}>
					<p className="mt-2 text-[22px] font-medium leading-snug tracking-tight text-pretty text-gc-text/80 md:text-[26px] lg:mt-6 lg:text-[28px]">
						<span className="font-semibold text-gc-text">{lead}</span> {body}
					</p>
					{bullets && bullets.length > 0 && (
						<ul className="mt-6 flex flex-col gap-2.5 text-[15px] leading-relaxed text-gc-text-dim">
							{bullets.map((b) => (
								<li key={b} className="flex gap-3">
									<span className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-gc-text-faint" />
									<span className="text-pretty">{b}</span>
								</li>
							))}
						</ul>
					)}
					{hint && <div className="mt-6 lg:mt-auto lg:pt-8">{hint}</div>}
				</div>
			</div>
		</section>
	);
}
