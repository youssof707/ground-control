import { watch } from "node:fs";
import { readRepoInfo, RepoError } from "./branches";
import { GitAbortedError } from "./gitProcess";

export async function watchHead(checkout: string, signal: AbortSignal): Promise<void> {
	const { gitDir } = await readRepoInfo(checkout, signal);
	if (!gitDir) throw new RepoError("failed", "no git dir");
	await new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(new GitAbortedError());
			return;
		}
		const watcher = watch(gitDir, { persistent: false });
		const finish = (err?: unknown): void => {
			signal.removeEventListener("abort", onAbort);
			watcher.close();
			if (err) reject(err);
			else resolve();
		};
		const onAbort = (): void => finish(new GitAbortedError());
		watcher.on("change", (_event, name) => {
			if (name === null || String(name) === "HEAD") finish();
		});
		watcher.on("error", (err) => finish(err));
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
