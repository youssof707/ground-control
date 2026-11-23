import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ScmCommitResult } from "../../shared/schemas/source_control";
import { resolveClaudeBinary } from "../sessions/SessionManager";
import { spawnClaudeProcess } from "../sessions/spawnClaudeProcess";
import { buildCommitPrompt, cleanCommitMessage, COMMIT_DIFF_LIMIT } from "./commitMessage";
import { runGit } from "./gitProcess";

const READ_TIMEOUT_MS = 60_000;
const GENERATE_TIMEOUT_MS = 2 * 60_000;
const COMMIT_TIMEOUT_MS = 5 * 60_000;

const running = new Set<AbortController>();

export function abortAllCommitMessages(): void {
	for (const controller of running) controller.abort();
	running.clear();
}

class CommitError extends Error {}

function lastLines(stderr: string, fallback: string): string {
	const lines = stderr
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("hint:"));
	return lines.slice(-6).join("\n") || fallback;
}

async function gitText(cwd: string, args: string[], maxStdout?: number): Promise<{ text: string; truncated: boolean }> {
	const result = await runGit({ cwd, args, maxStdout, timeoutMs: READ_TIMEOUT_MS });
	if (result.code !== 0 && !result.truncated) throw new CommitError(lastLines(result.stderr, `git ${args[0]} failed`));
	return { text: result.stdout.toString("utf8"), truncated: result.truncated };
}

async function generateMessage(checkout: string): Promise<string> {
	const stat = await gitText(checkout, ["diff", "--cached", "--stat", "--no-color"]);
	if (!stat.text.trim()) throw new CommitError("Nothing is staged.");
	const diff = await gitText(checkout, ["diff", "--cached", "--no-color", "--no-ext-diff"], COMMIT_DIFF_LIMIT);
	const log = await runGit({ cwd: checkout, args: ["log", "-n", "10", "--format=%s"], timeoutMs: READ_TIMEOUT_MS });
	const recent = log.code === 0 ? log.stdout.toString("utf8").split("\n").filter(Boolean) : [];
	const prompt = buildCommitPrompt({ stat: stat.text, diff: diff.text, truncated: diff.truncated, recent });

	const abort = new AbortController();
	running.add(abort);
	const timer = setTimeout(() => abort.abort(), GENERATE_TIMEOUT_MS);
	let text = "";
	try {
		const q = query({
			prompt,
			options: {
				cwd: checkout,
				model: "sonnet",
				maxTurns: 1,
				tools: [],
				persistSession: false,
				settingSources: [],
				pathToClaudeCodeExecutable: resolveClaudeBinary(),
				spawnClaudeCodeProcess: spawnClaudeProcess,
				abortController: abort,
			},
		});
		for await (const message of q) {
			if (message.type !== "result") continue;
			if (message.subtype === "success" && !message.is_error) text = message.result;
			break;
		}
	} catch (err) {
		if (abort.signal.aborted) throw new CommitError("Claude took too long to write a commit message.");
		throw new CommitError(`Claude couldn't write a commit message: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		clearTimeout(timer);
		running.delete(abort);
	}
	const message = cleanCommitMessage(text);
	if (!message) throw new CommitError("Claude didn't return a commit message.");
	return message;
}

async function commit(checkout: string, message: string): Promise<void> {
	const result = await runGit({
		cwd: checkout,
		args: ["commit", "-F", "-"],
		input: Buffer.from(message, "utf8"),
		timeoutMs: COMMIT_TIMEOUT_MS,
		env: { GIT_EDITOR: "true" },
	});
	if (result.code !== 0) {
		throw new CommitError(lastLines(result.stderr || result.stdout.toString("utf8"), "git commit failed"));
	}
}

async function stageAll(checkout: string): Promise<void> {
	const result = await runGit({ cwd: checkout, args: ["add", "-A"], timeoutMs: COMMIT_TIMEOUT_MS });
	if (result.code !== 0) throw new CommitError(lastLines(result.stderr, "git add failed"));
}

export async function runCommit(checkout: string, message: string, all: boolean): Promise<ScmCommitResult> {
	try {
		if (all) await stageAll(checkout);
		const final = message.trim() ? message : await generateMessage(checkout);
		await commit(checkout, final);
		return { ok: true, message: final };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
