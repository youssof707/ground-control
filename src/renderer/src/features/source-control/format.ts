export function compactCount(n: number): string {
	if (n < 10_000) return n.toLocaleString("en-US");
	if (n < 1_000_000) return `${trimZero((n / 1000).toFixed(n < 100_000 ? 1 : 0))}k`;
	return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

function trimZero(text: string): string {
	return text.endsWith(".0") ? text.slice(0, -2) : text;
}

export function plural(n: number, one: string, many: string): string {
	return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function formatAge(fetchedAt: number, now: number): string {
	const seconds = Math.floor(Math.max(0, now - fetchedAt) / 1000);
	if (seconds < 10) return "Updated just now";
	if (seconds < 60) return `Updated ${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `Updated ${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `Updated ${hours}h ago`;
	return `Updated ${Math.floor(hours / 24)}d ago`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 0) return "unknown size";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function leafName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export function shortAge(at: number, now: number): string {
	if (at <= 0) return "";
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(days / 365)}y`;
}
