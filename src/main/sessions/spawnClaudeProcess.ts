import { spawn } from "node:child_process";
import type {
	SpawnedProcess,
	SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

export function spawnClaudeProcess(options: SpawnOptions): SpawnedProcess {
	const child = spawn(options.command, options.args, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stdio: ["pipe", "pipe", "ignore"],
		windowsHide: true,
	});
	child.stdin.on("error", (err) => {
		console.warn("[ccw] claude CLI stdin closed:", err.message);
	});
	return child;
}
