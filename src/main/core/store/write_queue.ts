import PQueue from "p-queue";

// Single global write queue (concurrency 1) shared by every model's store.
// Read-modify-write tasks put their entire critical section inside one
// queue task so concurrent operations across any models can't race on
// shared state or interleave partial writes.
const writeQueue = new PQueue({ concurrency: 1 });

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
	return writeQueue.add(task) as Promise<T>;
}

/**
 * Wait for all pending writes (across every model) to drain. Call before
 * app quit so nothing is lost mid-flush.
 */
export async function flush(): Promise<void> {
	await writeQueue.onIdle();
}
