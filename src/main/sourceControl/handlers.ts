import { ipcMain } from "electron";
import type { ScmSnapshot } from "../../shared/schemas/source_control";
import { getSnapshot } from "./service";

const FAILED: ScmSnapshot = { ok: false, reason: "failed" };

export function registerSourceControlHandlers(): void {
	ipcMain.handle(
		"scm:snapshot",
		async (_e, payload: { cwd?: unknown } | undefined): Promise<ScmSnapshot> => {
			try {
				const cwd = payload?.cwd;
				if (typeof cwd !== "string" || cwd.length === 0) return FAILED;
				return await getSnapshot(cwd);
			} catch {
				return FAILED;
			}
		},
	);
}
