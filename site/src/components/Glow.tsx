import type { CSSProperties } from "react";

export type GlowTrio = [string, string, string];

type Props = {
	trio: GlowTrio;
	opacity?: number;
};

export function Glow({ trio, opacity = 0.2 }: Props) {
	const style: CSSProperties = {
		background: `radial-gradient(460px circle at var(--mx, 50%) var(--my, 50%), ${trio[0]}, ${trio[1]} 42%, ${trio[2]} 66%, transparent 80%)`,
		opacity: `calc(var(--glow, 0.55) * ${opacity})`,
		transition: "opacity .4s ease",
	};
	return <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[24px] blur-2xl" style={style} />;
}

export const glows = {
	accent: "oklch(0.76 0.10 250)",
	info: "oklch(0.80 0.09 210)",
	ok: "oklch(0.78 0.13 155)",
	warn: "oklch(0.75 0.15 60)",
	danger: "oklch(0.70 0.18 25)",
	babysit: "oklch(0.78 0.12 315)",
	neutral: "oklch(0.72 0.008 70)",
};
