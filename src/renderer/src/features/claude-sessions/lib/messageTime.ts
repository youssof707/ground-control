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

export function formatShortAgo(ts: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - ts) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
