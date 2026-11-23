const LEADING_SPACES = /^( +)(?=\S)/;

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

export function indentFactor(text: string): number {
	let unit = 0;
	for (const line of text.split("\n")) {
		const match = LEADING_SPACES.exec(line);
		if (!match || line[match[1].length] === "*") continue;
		unit = gcd(unit, match[1].length);
		if (unit === 1) return 1;
	}
	return unit === 2 ? 2 : 1;
}

export function widenIndent(text: string, factor: number): string {
	if (factor === 1) return text;
	return text.replace(/^ +(?=\S)/gm, (spaces) => spaces.repeat(factor));
}
