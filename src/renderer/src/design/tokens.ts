// Design tokens — dark, warm-neutral, IDE-friendly.
// Keep in sync with the CSS variables in src/renderer/src/index.css.

export const T = {
	bg: "oklch(0.16 0.005 60)",
	win: "oklch(0.19 0.006 60)",
	surface: "oklch(0.215 0.007 60)",
	surfaceHi: "oklch(0.245 0.008 60)",
	surfaceLow: "oklch(0.20 0.006 60)",
	border: "oklch(0.30 0.008 60)",
	borderSoft: "oklch(0.255 0.007 60)",

	text: "oklch(0.94 0.005 80)",
	textDim: "oklch(0.72 0.008 70)",
	textMute: "oklch(0.56 0.010 70)",
	textFaint: "oklch(0.42 0.010 70)",

	accent: "oklch(0.76 0.10 250)",
	accentSoft: "oklch(0.76 0.10 250 / 0.14)",
	accentBorder: "oklch(0.76 0.10 250 / 0.40)",
	accentInk: "#1a1410",

	ok: "oklch(0.78 0.13 155)",
	okSoft: "oklch(0.78 0.13 155 / 0.14)",
	okBorder: "oklch(0.78 0.13 155 / 0.30)",

	warn: "oklch(0.75 0.15 60)",
	warnSoft: "oklch(0.75 0.15 60 / 0.14)",
	warnBorder: "oklch(0.75 0.15 60 / 0.40)",

	neutral: "oklch(0.72 0.008 70)",
	neutralSoft: "oklch(0.72 0.008 70 / 0.14)",
	neutralBorder: "oklch(0.72 0.008 70 / 0.40)",

	danger: "oklch(0.70 0.18 25)",
	dangerSoft: "oklch(0.70 0.18 25 / 0.14)",
	dangerBorder: "oklch(0.70 0.18 25 / 0.40)",

	info: "oklch(0.80 0.09 210)",
	infoSoft: "oklch(0.80 0.09 210 / 0.14)",
	infoBorder: "oklch(0.80 0.09 210 / 0.30)",

	sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export type Tokens = typeof T;
