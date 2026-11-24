import type { GitFixRequest } from "../../shared/schemas/source_control";

export const GIT_FIX_SERVER_NAME = "git-fix";
export const GIT_FIX_REPORT_TOOL = `mcp__${GIT_FIX_SERVER_NAME}__report`;
export const GIT_FIX_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep"];

function describeTask(request: GitFixRequest): string {
	const branch = request.branch ?? "HEAD";
	if (request.op === "pull") {
		const from = request.upstream ? `the remote branch ${request.upstream}` : "its upstream branch";
		return `Pull the latest changes from ${from} into my local branch ${branch} and resolve any issues you run into.`;
	}
	if (!request.upstream) {
		return `Publish my local branch ${branch} to origin with its upstream set (git push -u origin HEAD) and resolve any issues you run into.`;
	}
	return `Push my local branch ${branch} to the remote branch ${request.upstream} and resolve any issues you run into.`;
}

function buildCommitFixPrompt(request: GitFixRequest): string {
	const branch = request.branch ?? "HEAD";
	return `Ground Control tried to commit my staged changes on ${branch} in ${request.checkout} and \`git commit\` failed with:

\`\`\`
${request.error.trim()}
\`\`\`

The commit message was:

\`\`\`
${(request.message ?? "").trim()}
\`\`\`

Find out why the commit failed and fix the cause so the same commit succeeds. Ground Control will run \`git commit\` again with the same message after you report success, so don't commit yourself.

You are a hidden background job. Nobody is watching and you can't ask questions.

Rules:
- Don't run \`git commit\`, and never bypass hooks or signing (no \`--no-verify\`, no changing \`core.hooksPath\` or \`commit.gpgsign\`).
- If a hook (pre-commit, commit-msg, lint, format) rejected the commit, fix the reported problems in the staged files and stage the fixes with \`git add <path>\`. Only touch files that are part of the commit.
- If a hook already rewrote files (a formatter), stage those changes.
- If a stale \`index.lock\` blocks git and no other git process is running, remove that lock file.
- Never lose work: no \`git reset --hard\`, \`git clean\`, \`git checkout -- <path>\`, or \`git stash drop\`, and don't unstage what I staged.
- Missing identity (user.name / user.email), signing keys, nothing staged, and unresolved merge conflicts can't be fixed here: report failure right away.

When you are done, call ${GIT_FIX_REPORT_TOOL} exactly once. Set success to true only if the cause is fixed and committing the staged changes with the same message should now work. The reason is one short sentence shown to the user.`;
}

export function buildGitFixPrompt(request: GitFixRequest): string {
	if (request.op === "commit") return buildCommitFixPrompt(request);
	return `${describeTask(request)}

The repository is ${request.checkout}. Ground Control already tried \`git ${request.op}\` there and it failed with:

\`\`\`
${request.error.trim()}
\`\`\`

You are a hidden background job. Nobody is watching and you can't ask questions.

Rules:
- Never force-push, delete remote branches, or rewrite commits that are already on the remote.
- Never lose work: no \`git reset --hard\`, \`git clean\`, \`git checkout -- <path>\`, or \`git stash drop\`. Keep uncommitted changes (for example with \`--autostash\` or \`git stash\` then \`git stash pop\`).
- If the histories diverged, rebase the local-only commits onto the remote (\`git pull --rebase --autostash\`), or merge when a rebase isn't possible.
- Resolve conflicts only when the right result is clear. Otherwise abort (\`git rebase --abort\` / \`git merge --abort\`) so the repo is back to how it started, and report failure.
- Authentication, permission, network and missing-remote errors can't be fixed here: report failure right away.

When you are done, call ${GIT_FIX_REPORT_TOOL} exactly once. Set success to true only if the ${request.op} really completed and the local branch is now in sync with the remote. The reason is one short sentence shown to the user.`;
}

function segments(command: string): string[][] {
	return command
		.split(/&&|\|\||[;|\n&]/)
		.map((part) => part.trim().split(/\s+/).filter(Boolean))
		.filter((words) => words.length > 0);
}

function gitSubcommand(words: string[]): { sub: string; args: string[] } | null {
	const start = words.indexOf("git");
	if (start === -1) return null;
	for (let i = start + 1; i < words.length; i++) {
		const word = words[i];
		if (word === "-C" || word === "-c" || word === "--git-dir" || word === "--work-tree") {
			i++;
			continue;
		}
		if (word.startsWith("-")) continue;
		return { sub: word, args: words.slice(i + 1) };
	}
	return null;
}

function hasShortFlag(args: string[], flag: string): boolean {
	return args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(flag));
}

function gitDenial(sub: string, args: string[], op: GitFixRequest["op"] | undefined): string | null {
	const has = (...names: string[]): boolean => args.some((a) => names.includes(a));
	const resolvesConflict = has("--ours", "--theirs");
	if (op === "commit") {
		if (sub === "commit") return "Don't commit; Ground Control commits again after you report.";
		if (sub === "config" && args.some((a) => /^(core\.hookspath|commit\.gpgsign)$/i.test(a))) {
			return "Disabling hooks or signing is not allowed.";
		}
	}
	switch (sub) {
		case "push":
			if (args.some((a) => a.startsWith("--force") || a.startsWith("+") || a.startsWith(":"))) return "Force-pushing is not allowed.";
			if (hasShortFlag(args, "f")) return "Force-pushing is not allowed.";
			if (has("--delete", "--mirror", "--prune") || hasShortFlag(args, "d")) return "Deleting remote refs is not allowed.";
			return null;
		case "reset":
			return has("--hard", "--merge", "--keep") ? "Discarding changes with git reset is not allowed." : null;
		case "clean":
			return "git clean is not allowed.";
		case "checkout":
			if (resolvesConflict) return null;
			if (has("--", ".", "--force") || hasShortFlag(args, "f")) return "Discarding changes with git checkout is not allowed.";
			return null;
		case "restore":
			if (resolvesConflict) return null;
			if (has("--staged", "-S") && !has("--worktree", "-W")) return null;
			return "Discarding changes with git restore is not allowed.";
		case "stash":
			return has("drop", "clear") ? "Dropping stashes is not allowed." : null;
		case "branch":
			return has("-D", "--force") || hasShortFlag(args, "D") ? "Force-deleting branches is not allowed." : null;
		case "reflog":
			return has("expire", "delete") ? "Editing the reflog is not allowed." : null;
		case "filter-branch":
		case "filter-repo":
		case "update-ref":
			return `git ${sub} is not allowed.`;
		case "config":
			return has("--global", "--system") ? "Changing global git config is not allowed." : null;
		default:
			return null;
	}
}

const SAFE_PROGRAMS = new Set([
	"git",
	"rm",
	"ls",
	"cat",
	"head",
	"tail",
	"grep",
	"rg",
	"echo",
	"pwd",
	"wc",
	"diff",
	"cd",
	"true",
	"sort",
	"uniq",
]);

function usesShellIndirection(command: string): boolean {
	if (/\$\(|`|<\(|>\(|\$\{|\\/.test(command)) return true;
	return />/.test(command.replace(/[0-9]?>&[0-9]/g, ""));
}

export function gitFixDenial(
	toolName: string,
	input: Record<string, unknown>,
	op?: GitFixRequest["op"],
): string | null {
	if (toolName === GIT_FIX_REPORT_TOOL) return null;
	if (!GIT_FIX_TOOLS.includes(toolName)) return `${toolName} is not available in this job.`;
	if (toolName !== "Bash") return null;
	const command = typeof input.command === "string" ? input.command : "";
	if (usesShellIndirection(command)) return "Command substitution, escapes and redirection to files are not allowed.";
	for (const words of segments(command.replace(/[0-9]?>&[0-9]/g, " "))) {
		if (!SAFE_PROGRAMS.has(words[0])) return `${words[0]} is not allowed in this job.`;
		if (words[0] === "rm" && words.slice(1).some((w) => /^-[a-zA-Z]*[rRf]/.test(w) || w.startsWith("--"))) {
			return "Recursive or forced rm is not allowed.";
		}
		if (words[0] !== "git") continue;
		if (words.some((w) => w === "-c" || w.startsWith("alias.") || w.startsWith("--exec"))) {
			return "Overriding git config or aliases is not allowed.";
		}
		const git = gitSubcommand(words);
		if (!git) continue;
		const denial = gitDenial(git.sub, git.args, op);
		if (denial) return denial;
	}
	return null;
}
