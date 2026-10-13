const UNITS: [label: string, seconds: number][] = [
	["day", 86400],
	["hour", 3600],
	["min", 60],
	["second", 1],
];

export function formatMessageTime(ts: number): string {
	const elapsed = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	for (const [label, seconds] of UNITS) {
		const count = Math.floor(elapsed / seconds);
		if (count >= 1) return `${count} ${label}${count === 1 ? "" : "s"} ago`;
	}
	return "just now";
}
