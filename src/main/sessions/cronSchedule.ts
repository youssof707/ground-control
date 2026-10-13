const MINUTE_MS = 60_000;
const SEARCH_LIMIT_MINUTES = 366 * 24 * 60;

interface FieldSpec {
	min: number;
	max: number;
}

const FIELDS: FieldSpec[] = [
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31 },
	{ min: 1, max: 12 },
	{ min: 0, max: 7 },
];

interface ParsedField {
	values: Set<number>;
	wildcard: boolean;
}

function parseField(text: string, spec: FieldSpec): ParsedField | null {
	const values = new Set<number>();
	for (const part of text.split(",")) {
		const [range, stepText] = part.split("/");
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step < 1) return null;
		let lo: number;
		let hi: number;
		if (range === "*") {
			lo = spec.min;
			hi = spec.max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-").map(Number);
			lo = a;
			hi = b;
		} else {
			lo = Number(range);
			hi = stepText === undefined ? lo : spec.max;
		}
		if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
		if (lo < spec.min || hi > spec.max || lo > hi) return null;
		for (let v = lo; v <= hi; v += step) values.add(v);
	}
	return { values, wildcard: text === "*" };
}

export function nextCronFire(expr: string, fromMs: number): number | null {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	const parsed = parts.map((p, i) => parseField(p, FIELDS[i]));
	if (parsed.some((p) => p === null)) return null;
	const [minute, hour, dom, month, dow] = parsed as ParsedField[];
	if (dow.values.has(7)) dow.values.add(0);

	const t = new Date(fromMs);
	t.setSeconds(0, 0);
	t.setTime(t.getTime() + MINUTE_MS);
	for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++) {
		const domHit = dom.values.has(t.getDate());
		const dowHit = dow.values.has(t.getDay());
		const dayHit =
			dom.wildcard || dow.wildcard ? domHit && dowHit : domHit || dowHit;
		if (
			month.values.has(t.getMonth() + 1) &&
			dayHit &&
			hour.values.has(t.getHours()) &&
			minute.values.has(t.getMinutes())
		) {
			return t.getTime();
		}
		t.setTime(t.getTime() + MINUTE_MS);
	}
	return null;
}
