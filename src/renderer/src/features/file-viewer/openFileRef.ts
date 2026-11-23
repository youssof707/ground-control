import type { FileRef } from "./fileRef";
import { useFileViewerStore } from "./useFileViewerStore";

let latest = 0;

export async function openFileRef(ref: FileRef, cwd: string | undefined): Promise<void> {
	const token = ++latest;
	const result = await window.claude.readFile({ path: ref.path, cwd });
	if (token !== latest) return;
	switch (result.kind) {
		case "binary":
		case "directory":
		case "too-large":
			await window.claude.revealPath(result.path);
			return;
		default:
			useFileViewerStore.getState().open({ ref, result });
	}
}
