import { describe, expect, it } from "vitest";
import { T } from "../../design/tokens";
import { oklchToHex } from "./oklch";

describe("oklchToHex", () => {
	it("converts known reference colors", () => {
		expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
		expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
		expect(oklchToHex("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
		expect(oklchToHex("oklch(0.452 0.3132 264.05)")).toBe("#0000ff");
	});

	it("keeps alpha from the color or an override", () => {
		expect(oklchToHex("oklch(1 0 0 / 0.5)")).toBe("#ffffff80");
		expect(oklchToHex("oklch(1 0 0)", 0.25)).toBe("#ffffff40");
		expect(oklchToHex("#1a1410", 1)).toBe("#1a1410ff");
	});

	it("converts every design token color", () => {
		for (const [key, value] of Object.entries(T)) {
			if (key === "sans" || key === "mono") continue;
			expect(oklchToHex(value)).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
		}
	});
});
