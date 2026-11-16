import { describe, expect, it } from "vitest";
import type { ScmBranch } from "@shared/schemas/source_control";
import { indexBranches, searchBranches } from "./branchSearch";
import { shortAge } from "./format";

function local(name: string): ScmBranch {
	return { name, remote: null, date: 0, worktree: null };
}

function remote(name: string): ScmBranch {
	return { name, remote: "origin", date: 0, worktree: null };
}

const names = (branches: ReturnType<typeof searchBranches>) => branches.items.map((i) => i.branch.name);

describe("searchBranches", () => {
	const index = indexBranches(
		[local("feature/login-form"), remote("origin/fix-login"), local("main"), local("chore/bump"), local("mlogin")],
		"main",
	);

	it("puts the current branch first, then locals, then remotes when empty", () => {
		expect(names(searchBranches(index, "", 10))).toEqual([
			"main",
			"feature/login-form",
			"chore/bump",
			"mlogin",
			"origin/fix-login",
		]);
	});

	it("ranks word-boundary substrings above fuzzy matches and requires every token", () => {
		expect(names(searchBranches(index, "login", 10))).toEqual(["feature/login-form", "origin/fix-login", "mlogin"]);
		expect(names(searchBranches(index, "fl", 10))).toContain("feature/login-form");
		expect(names(searchBranches(index, "login form", 10))).toEqual(["feature/login-form"]);
		expect(searchBranches(index, "zzz", 10).total).toBe(0);
	});

	it("caps results but reports the full match count", () => {
		const result = searchBranches(index, "", 2);
		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(5);
	});
});

describe("shortAge", () => {
	it("formats compact ages", () => {
		const now = 1_000_000_000_000;
		expect(shortAge(0, now)).toBe("");
		expect(shortAge(now - 30_000, now)).toBe("now");
		expect(shortAge(now - 5 * 60_000, now)).toBe("5m");
		expect(shortAge(now - 3 * 3_600_000, now)).toBe("3h");
		expect(shortAge(now - 2 * 86_400_000, now)).toBe("2d");
		expect(shortAge(now - 90 * 86_400_000, now)).toBe("3mo");
		expect(shortAge(now - 800 * 86_400_000, now)).toBe("2y");
	});
});
