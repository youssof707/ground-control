import { describe, expect, it } from "vitest";
import { isHeavy, onlyLineEndingsDiffer } from "./diffText";
import { compactCount, formatAge, formatBytes } from "./format";

describe("compactCount", () => {
	it("keeps small numbers exact and compacts big ones", () => {
		expect(compactCount(0)).toBe("0");
		expect(compactCount(9_999)).toBe("9,999");
		expect(compactCount(12_345)).toBe("12.3k");
		expect(compactCount(20_000)).toBe("20k");
		expect(compactCount(123_456)).toBe("123k");
		expect(compactCount(1_250_000)).toBe("1.3M");
	});
});

describe("formatAge and formatBytes", () => {
	it("describes how old a scan is", () => {
		expect(formatAge(0, 5_000)).toBe("Updated just now");
		expect(formatAge(0, 45_000)).toBe("Updated 45s ago");
		expect(formatAge(0, 5 * 60_000)).toBe("Updated 5m ago");
	});

	it("formats sizes", () => {
		expect(formatBytes(-1)).toBe("unknown size");
		expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
	});
});

describe("diff text checks", () => {
	it("flags very large text and very long lines", () => {
		expect(isHeavy("a\n".repeat(10))).toBe(false);
		expect(isHeavy("x".repeat(300 * 1024))).toBe(true);
		expect(isHeavy(`short\n${"y".repeat(10_001)}\nshort`)).toBe(true);
		expect(isHeavy(`${"z".repeat(9_000)}\n`.repeat(5))).toBe(false);
	});

	it("spots changes that are only line endings", () => {
		expect(onlyLineEndingsDiffer("a\nb\n", "a\r\nb\r\n")).toBe(true);
		expect(onlyLineEndingsDiffer("a\nb\n", "a\nc\n")).toBe(false);
		expect(onlyLineEndingsDiffer("same", "same")).toBe(false);
	});
});
