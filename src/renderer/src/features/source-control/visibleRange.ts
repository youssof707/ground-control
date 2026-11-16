export function visibleRange(
	scrollTop: number,
	viewport: number,
	rowHeight: number,
	count: number,
	overscan: number,
): { start: number; end: number } {
	if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
	const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
	const visible = Math.ceil(Math.max(0, viewport) / rowHeight) + 1;
	const start = Math.max(0, Math.min(count - 1, first - overscan));
	const end = Math.min(count, first + visible + overscan);
	return { start, end: Math.max(start, end) };
}

export function scrollToReveal(
	index: number,
	scrollTop: number,
	viewport: number,
	rowHeight: number,
): number {
	const top = index * rowHeight;
	const bottom = top + rowHeight;
	if (top < scrollTop) return top;
	if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport);
	return scrollTop;
}

export function nextIndex(
	key: string,
	current: number,
	count: number,
	pageSize: number,
): number | null {
	if (count === 0) return null;
	const from = current < 0 ? -1 : current;
	switch (key) {
		case "ArrowDown":
			return Math.min(count - 1, from + 1);
		case "ArrowUp":
			return Math.max(0, from < 0 ? 0 : from - 1);
		case "PageDown":
			return Math.min(count - 1, Math.max(0, from) + pageSize);
		case "PageUp":
			return Math.max(0, Math.max(0, from) - pageSize);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
