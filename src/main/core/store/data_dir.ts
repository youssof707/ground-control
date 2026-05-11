import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import path from "node:path";

/**
 * Single source of truth for where the on-disk store lives.
 *
 * Dev builds use a repo-local `.dev-store/` so dev data is isolated from any
 * installed prod build's userData. Prod builds use the Electron userData dir.
 */
export function resolveDataDir(): string {
	return is.dev
		? path.join(process.cwd(), ".dev-store")
		: path.join(app.getPath("userData"), "data");
}
