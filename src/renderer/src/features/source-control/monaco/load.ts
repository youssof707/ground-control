export type MonacoModule = typeof import("./setup");

let monacoPromise: Promise<MonacoModule> | null = null;

export function loadMonaco(): Promise<MonacoModule> {
	if (!monacoPromise) {
		monacoPromise = import("./setup").catch((err: unknown) => {
			monacoPromise = null;
			throw err;
		});
	}
	return monacoPromise;
}
