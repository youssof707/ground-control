import { spawn } from "node:child_process";

const STDERR_TAIL = 4096;

export class GitMissingError extends Error {
	constructor() {
		super("git is not installed");
	}
}

export class GitAbortedError extends Error {
	constructor() {
		super("git was cancelled");
	}
}

export class GitTimeoutError extends Error {
	constructor() {
		super("git timed out");
	}
}

export interface GitOptions {
	cwd: string;
	args: string[];
	signal?: AbortSignal;
	timeoutMs?: number;
	onStdout?: (chunk: Buffer) => void;
	maxStdout?: number;
	input?: Buffer;
}

export interface GitResult {
	code: number | null;
	stderr: string;
	stdout: Buffer;
	truncated: boolean;
}

let gitBinary = "git";

export function setGitBinary(path: string): void {
	gitBinary = path;
}

export const GIT_ENV = {
	GIT_OPTIONAL_LOCKS: "0",
	GIT_TERMINAL_PROMPT: "0",
	LC_ALL: "C",
	LANG: "C",
};

export function runGit(options: GitOptions): Promise<GitResult> {
	const { cwd, args, signal, timeoutMs, onStdout, maxStdout, input } = options;
	if (signal?.aborted) return Promise.reject(new GitAbortedError());

	return new Promise<GitResult>((resolve, reject) => {
		const child = spawn(gitBinary, ["--no-optional-locks", ...args], {
			cwd,
			env: { ...process.env, ...GIT_ENV },
			stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
		});
		const { stdout, stderr: errStream } = child;
		if (!stdout || !errStream) {
			reject(new Error("git has no output pipes"));
			return;
		}
		if (input && child.stdin) {
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		}
		const chunks: Buffer[] = [];
		let size = 0;
		let truncated = false;
		let stderr = "";
		let settled = false;
		let failure: Error | null = null;
		let timer: NodeJS.Timeout | null = null;

		const stop = (err: Error | null): void => {
			if (failure === null && err) failure = err;
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		};
		const onAbort = (): void => stop(new GitAbortedError());
		const cleanup = (): void => {
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => stop(new GitTimeoutError()), timeoutMs);
		}

		stdout.on("data", (chunk: Buffer) => {
			if (failure || truncated) return;
			if (onStdout) {
				try {
					onStdout(chunk);
				} catch (err) {
					stop(err instanceof Error ? err : new Error(String(err)));
				}
				return;
			}
			if (maxStdout !== undefined && size + chunk.length > maxStdout) {
				const room = maxStdout - size;
				if (room > 0) chunks.push(chunk.subarray(0, room));
				size = maxStdout;
				truncated = true;
				stop(null);
				return;
			}
			chunks.push(chunk);
			size += chunk.length;
		});
		errStream.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
		});
		child.on("error", (err: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err.code === "ENOENT" ? new GitMissingError() : err);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (failure) {
				reject(failure);
				return;
			}
			resolve({
				code,
				stderr,
				stdout: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size),
				truncated,
			});
		});
	});
}

export function isNotARepo(stderr: string): boolean {
	return /not a git repository/i.test(stderr);
}
