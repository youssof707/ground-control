import type { ScmRemoteOp } from "../../shared/schemas/source_control";
import { isNotARepo, runGit } from "./gitProcess";
import { RepoError } from "./branches";

const REMOTE_ENV = { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
const FETCH_TIMEOUT_MS = 2 * 60_000;
const WRITE_TIMEOUT_MS = 5 * 60_000;

export function remoteArgs(op: ScmRemoteOp, hasUpstream: boolean): string[] {
	switch (op) {
		case "fetch":
			return ["fetch", "--prune", "--no-recurse-submodules"];
		case "pull":
			return ["pull", "--ff-only", "--no-recurse-submodules"];
		case "push":
			return hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"];
	}
}

async function hasUpstream(checkout: string, signal: AbortSignal | undefined): Promise<boolean> {
	const result = await runGit({
		cwd: checkout,
		args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		signal,
		timeoutMs: 30_000,
	});
	return result.code === 0;
}

function cleanError(stderr: string, op: ScmRemoteOp): string {
	const lines = stderr
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("hint:"));
	return lines.join("\n") || `git ${op} failed`;
}

export async function runRemote(checkout: string, op: ScmRemoteOp, signal: AbortSignal | undefined): Promise<void> {
	const upstream = op === "push" ? await hasUpstream(checkout, signal) : true;
	const result = await runGit({
		cwd: checkout,
		args: remoteArgs(op, upstream),
		signal,
		env: REMOTE_ENV,
		timeoutMs: op === "fetch" ? FETCH_TIMEOUT_MS : WRITE_TIMEOUT_MS,
	});
	if (result.code !== 0) {
		throw new RepoError(isNotARepo(result.stderr) ? "not-a-repo" : "failed", cleanError(result.stderr, op));
	}
}
