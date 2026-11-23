import { describe, expect, it } from "vitest";
import { buildGitFixPrompt, gitFixDenial, GIT_FIX_REPORT_TOOL } from "./gitFixPolicy";

const bash = (command: string): string | null => gitFixDenial("Bash", { command });

describe("gitFixDenial", () => {
	it("allows the tools a fix needs", () => {
		expect(gitFixDenial("Read", { file_path: "/x" })).toBeNull();
		expect(gitFixDenial("Edit", {})).toBeNull();
		expect(gitFixDenial(GIT_FIX_REPORT_TOOL, {})).toBeNull();
	});

	it("blocks tools outside the job", () => {
		expect(gitFixDenial("WebFetch", {})).not.toBeNull();
		expect(gitFixDenial("Agent", {})).not.toBeNull();
	});

	it.each([
		"git status",
		"git pull --rebase --autostash",
		"git fetch --prune && git rebase origin/main",
		"git push",
		"git push -u origin HEAD",
		"git push origin HEAD:main",
		"git stash && git pull && git stash pop",
		"git checkout --theirs -- src/a.ts",
		"git checkout -b fix",
		"git restore --staged src/a.ts",
		"git restore --ours src/a.ts",
		"git rebase --abort",
		"git reset --soft HEAD~1",
		"git -C /repo merge origin/main",
		"rm .git/index.lock",
		"git commit --no-edit 2>&1",
	])("allows %s", (command) => {
		expect(bash(command)).toBeNull();
	});

	it.each([
		"git push --force",
		"git push -f origin main",
		"git push --force-with-lease",
		"git push origin +main",
		"git push origin :old",
		"git push --delete origin old",
		"git -C /repo push -uf origin HEAD",
		"git fetch && git reset --hard origin/main",
		"git clean -fd",
		"git checkout -- .",
		"git checkout .",
		"git restore src/a.ts",
		"git stash drop",
		"git branch -D feature",
		"git config --global pull.rebase true",
		"git status; rm -rf src",
		'bash -c "git reset --hard"',
		"sh -c 'git clean -fd'",
		"eval git reset --hard",
		"echo $(git reset --hard)",
		"echo `git clean -fd`",
		"/usr/bin/git reset --hard",
		"env git push --force",
		"GIT_DIR=x git reset --hard",
		"xargs git clean -fd",
		"git -c alias.up='reset --hard' up",
		"git config alias.up reset",
		"git re\\set --hard",
		"rm -f src/a.ts",
		"echo x > src/a.ts",
		"python3 -c 'import os'",
	])("blocks %s", (command) => {
		expect(bash(command)).not.toBeNull();
	});
});

describe("buildGitFixPrompt", () => {
	const base = { checkout: "/repo", branch: "feat", upstream: "origin/feat", error: "fatal: Not possible to fast-forward\n" };

	it("describes a pull", () => {
		const prompt = buildGitFixPrompt({ ...base, op: "pull" });
		expect(prompt).toContain("Pull the latest changes from the remote branch origin/feat into my local branch feat");
		expect(prompt).toContain("fatal: Not possible to fast-forward\n```");
		expect(prompt).toContain(GIT_FIX_REPORT_TOOL);
	});

	it("describes a push and a publish", () => {
		expect(buildGitFixPrompt({ ...base, op: "push" })).toContain("Push my local branch feat to the remote branch origin/feat");
		expect(buildGitFixPrompt({ ...base, op: "push", upstream: null })).toContain("Publish my local branch feat to origin");
	});
});
