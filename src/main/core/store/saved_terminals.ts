import { mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
	SavedTerminalsFileSchema,
	type SavedTerminalGroup,
} from "../../../shared/schemas/terminals";
import { resolveDataDir } from "./data_dir";

function filePath(): string {
	return path.join(resolveDataDir(), "saved_terminals.json");
}

export async function loadSavedTerminals(): Promise<SavedTerminalGroup[]> {
	try {
		const text = await fs.readFile(filePath(), "utf8");
		const parsed = SavedTerminalsFileSchema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data.groups : [];
	} catch {
		return [];
	}
}

export function saveTerminalsSync(groups: SavedTerminalGroup[]): void {
	mkdirSync(path.dirname(filePath()), { recursive: true });
	writeFileAtomic.sync(filePath(), JSON.stringify({ groups }, null, 2));
}
