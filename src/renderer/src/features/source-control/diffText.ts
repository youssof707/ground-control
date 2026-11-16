const HEAVY_CHARS = 256 * 1024;
const HEAVY_LINE = 10_000;

export function isHeavy(text: string): boolean {
	if (text.length > HEAVY_CHARS) return true;
	if (text.length <= HEAVY_LINE) return false;
	let start = 0;
	while (start < text.length) {
		const nl = text.indexOf("\n", start);
		const end = nl === -1 ? text.length : nl;
		if (end - start > HEAVY_LINE) return true;
		start = end + 1;
	}
	return false;
}

export function onlyLineEndingsDiffer(original: string, modified: string): boolean {
	if (original === modified) return false;
	if (!original.includes("\r") && !modified.includes("\r")) return false;
	return original.replace(/\r\n/g, "\n") === modified.replace(/\r\n/g, "\n");
}
