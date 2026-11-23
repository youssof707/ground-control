import {
	createSdkMcpServer,
	query,
	tool,
	type HookCallback,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { GitFixRequest, GitFixResult } from "../../shared/schemas/source_control";
import { resolveClaudeBinary } from "../sessions/SessionManager";
import { spawnClaudeProcess } from "../sessions/spawnClaudeProcess";
import {
	buildGitFixPrompt,
	gitFixDenial,
	GIT_FIX_REPORT_TOOL,
	GIT_FIX_SERVER_NAME,
	GIT_FIX_TOOLS,
} from "./gitFixPolicy";

const FIX_TIMEOUT_MS = 5 * 60_000;
const MAX_TURNS = 40;

const running = new Map<string, AbortController>();

export function abortAllGitFixes(): void {
	for (const controller of running.values()) controller.abort();
	running.clear();
}

function reportServer(onReport: (result: GitFixResult) => void) {
	return createSdkMcpServer({
		name: GIT_FIX_SERVER_NAME,
		version: "1.0.0",
		alwaysLoad: true,
		tools: [
			tool(
				"report",
				"Report whether the git operation now succeeds. Call exactly once when done.",
				{
					success: z.boolean().describe("true only if the pull or push completed and the branch is in sync"),
					reason: z.string().min(1).max(300).describe("One short sentence for the user"),
				},
				async ({ success, reason }) => {
					onReport({ fixed: success, reason: reason.trim() });
					return { content: [{ type: "text", text: "Recorded." }] };
				},
			),
		],
	});
}

const denyHook: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse") return {};
	const denial = gitFixDenial(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
	if (!denial) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: denial,
		},
	};
};

export async function runGitAutoFix(request: GitFixRequest): Promise<GitFixResult> {
	if (running.has(request.checkout)) {
		return { fixed: false, reason: "A fix is already running for this checkout." };
	}
	const abort = new AbortController();
	running.set(request.checkout, abort);
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		abort.abort();
	}, FIX_TIMEOUT_MS);
	const outcome: { report: GitFixResult | null } = { report: null };
	let finish: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => {
		finish = resolve;
		abort.signal.addEventListener("abort", () => resolve(), { once: true });
	});

	async function* prompt(): AsyncGenerator<SDKUserMessage, void, void> {
		yield {
			type: "user",
			message: { role: "user", content: buildGitFixPrompt(request) },
			parent_tool_use_id: null,
		};
		await finished;
	}

	try {
		const q = query({
			prompt: prompt(),
			options: {
				cwd: request.checkout,
				model: "sonnet",
				maxTurns: MAX_TURNS,
				persistSession: false,
				settingSources: ["user"],
				tools: GIT_FIX_TOOLS,
				allowedTools: [GIT_FIX_REPORT_TOOL],
				permissionMode: "default",
				pathToClaudeCodeExecutable: resolveClaudeBinary(),
				spawnClaudeCodeProcess: spawnClaudeProcess,
				abortController: abort,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
					GIT_EDITOR: "true",
				},
				mcpServers: {
					[GIT_FIX_SERVER_NAME]: reportServer((result) => {
						outcome.report ??= result;
					}),
				},
				hooks: { PreToolUse: [{ hooks: [denyHook] }] },
				canUseTool: async (toolName, input) => {
					const denial = gitFixDenial(toolName, input);
					return denial
						? { behavior: "deny", message: denial }
						: { behavior: "allow", updatedInput: input };
				},
			},
		});
		for await (const message of q) {
			if (message.type === "result") break;
		}
	} catch (err) {
		if (!outcome.report && !abort.signal.aborted) {
			return { fixed: false, reason: `Claude couldn't run: ${err instanceof Error ? err.message : String(err)}` };
		}
	} finally {
		clearTimeout(timer);
		finish();
		abort.abort();
		if (running.get(request.checkout) === abort) running.delete(request.checkout);
	}
	if (outcome.report) return outcome.report;
	if (timedOut) return { fixed: false, reason: "Claude ran out of time trying to fix it." };
	return { fixed: false, reason: "Claude stopped without fixing it." };
}
