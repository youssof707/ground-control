import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd },
		);
		const branch = stdout.trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

export async function getHeadCommit(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "HEAD"],
			{ cwd },
		);
		const sha = stdout.trim();
		return sha || undefined;
	} catch {
		return undefined;
	}
}

export async function getDiffSinceCommit(
	cwd: string,
	sha: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", sha],
			{ cwd, maxBuffer: 64 * 1024 * 1024 },
		);
		return stdout || "";
	} catch {
		return undefined;
	}
}
