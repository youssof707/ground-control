const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i;

function toGamma(x: number): number {
	const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
	return Math.min(1, Math.max(0, v));
}

function hex2(v: number): string {
	return Math.round(Math.min(1, Math.max(0, v)) * 255)
		.toString(16)
		.padStart(2, "0");
}

export function oklchToHex(color: string, alphaOverride?: number): string {
	const trimmed = color.trim();
	if (trimmed.startsWith("#")) {
		const base = trimmed.length === 4
			? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
			: trimmed.slice(0, 7);
		return alphaOverride === undefined ? base : `${base}${hex2(alphaOverride)}`;
	}
	const match = OKLCH.exec(trimmed);
	if (!match) throw new Error(`Unsupported color: ${color}`);
	const L = Number(match[1]) / (match[2] ? 100 : 1);
	const C = Number(match[3]);
	const H = (Number(match[4]) * Math.PI) / 180;
	const parsedAlpha = match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1);
	const alpha = alphaOverride ?? parsedAlpha;

	const a = C * Math.cos(H);
	const b = C * Math.sin(H);
	const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
	const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
	const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);

	const r = toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g = toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

	const rgb = `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
	return alpha >= 1 ? rgb : `${rgb}${hex2(alpha)}`;
}
