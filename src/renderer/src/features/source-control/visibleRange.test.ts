import { describe, expect, it } from "vitest";
import { nextIndex, scrollToReveal, visibleRange } from "./visibleRange";

describe("visibleRange", () => {
	it("covers the viewport plus overscan", () => {
		expect(visibleRange(0, 260, 26, 50_000, 5)).toEqual({ start: 0, end: 16 });
		expect(visibleRange(26 * 1000, 260, 26, 50_000, 5)).toEqual({ start: 995, end: 1016 });
	});

	it("clamps at the end of the list", () => {
		expect(visibleRange(26 * 49_995, 260, 26, 50_000, 5)).toEqual({ start: 49_990, end: 50_000 });
	});

	it("handles empty lists and unmeasured viewports", () => {
		expect(visibleRange(0, 0, 26, 0, 5)).toEqual({ start: 0, end: 0 });
		expect(visibleRange(0, 0, 26, 10, 5)).toEqual({ start: 0, end: 6 });
	});

	it("keeps rendering bounded for any scroll offset", () => {
		for (const top of [0, 1, 13, 1_299_974, 5_000_000]) {
			const { start, end } = visibleRange(top, 900, 26, 50_000, 12);
			expect(end - start).toBeLessThanOrEqual(Math.ceil(900 / 26) + 1 + 24);
			expect(start).toBeGreaterThanOrEqual(0);
			expect(end).toBeLessThanOrEqual(50_000);
		}
	});
});

describe("scrollToReveal", () => {
	it("scrolls only when the row is out of view", () => {
		expect(scrollToReveal(5, 0, 260, 26)).toBe(0);
		expect(scrollToReveal(20, 0, 260, 26)).toBe(26 * 21 - 260);
		expect(scrollToReveal(2, 260, 260, 26)).toBe(52);
	});
});

describe("nextIndex", () => {
	it("moves with arrows, pages and ends", () => {
		expect(nextIndex("ArrowDown", 3, 10, 4)).toBe(4);
		expect(nextIndex("ArrowUp", 3, 10, 4)).toBe(2);
		expect(nextIndex("ArrowUp", 0, 10, 4)).toBe(0);
		expect(nextIndex("ArrowDown", 9, 10, 4)).toBe(9);
		expect(nextIndex("PageDown", 8, 10, 4)).toBe(9);
		expect(nextIndex("PageUp", 2, 10, 4)).toBe(0);
		expect(nextIndex("Home", 5, 10, 4)).toBe(0);
		expect(nextIndex("End", 5, 10, 4)).toBe(9);
	});

	it("starts from the top when nothing is selected", () => {
		expect(nextIndex("ArrowDown", -1, 10, 4)).toBe(0);
		expect(nextIndex("ArrowUp", -1, 10, 4)).toBe(0);
	});

	it("ignores other keys and empty lists", () => {
		expect(nextIndex("a", 1, 10, 4)).toBeNull();
		expect(nextIndex("ArrowDown", 0, 0, 4)).toBeNull();
	});
});
