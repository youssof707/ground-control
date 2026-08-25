import { ipcMain } from "electron";
import { ulid } from "ulid";
import * as shortcutsStore from "../core/store/shortcuts";
import { broadcast } from "../windows";
import {
	CreateShortcutInputSchema,
	type CreateShortcutInput,
	UpdateShortcutInputSchema,
	type UpdateShortcutInput,
} from "../../shared/schemas/shortcuts";

/**
 * IPC surface for saved session shortcuts. Mirrors groupsHandlers:
 * one `register*Handlers()` per feature, called from
 * `registerSessionsHandlers` at boot. Validation/trimming happens here
 * (not in the store); ids and timestamps are minted here; every mutation
 * ends with a skip-self `state:changed` broadcast because the
 * originating window applies the invoke result optimistically.
 */
export function registerShortcutsHandlers(): void {
	ipcMain.handle("shortcuts:list", () => shortcutsStore.list());

	ipcMain.handle(
		"shortcuts:create",
		async (e, rawInput: CreateShortcutInput) => {
			const input = CreateShortcutInputSchema.parse(rawInput);
			const cwd = input.cwd.trim();
			const prompt = input.prompt.trim();
			if (!cwd) throw new Error("Shortcut folder is required");
			if (!prompt) throw new Error("Shortcut prompt is required");
			const shortcut = await shortcutsStore.create({
				id: ulid(),
				title: input.title.trim(),
				cwd,
				prompt,
				mode: input.mode,
				createdAt: Date.now(),
			});
			broadcast("state:changed", undefined, e.sender.id);
			return shortcut;
		},
	);

	ipcMain.handle(
		"shortcuts:update",
		async (e, rawInput: UpdateShortcutInput) => {
			const input = UpdateShortcutInputSchema.parse(rawInput);
			const cwd = input.cwd.trim();
			const prompt = input.prompt.trim();
			if (!cwd) throw new Error("Shortcut folder is required");
			if (!prompt) throw new Error("Shortcut prompt is required");
			const updated = await shortcutsStore.update(input.id, {
				title: input.title.trim(),
				cwd,
				prompt,
				mode: input.mode,
			});
			if (!updated) throw new Error("Shortcut not found");
			broadcast("state:changed", undefined, e.sender.id);
			return updated;
		},
	);

	ipcMain.handle("shortcuts:delete", async (e, id: string) => {
		await shortcutsStore.remove(id);
		broadcast("state:changed", undefined, e.sender.id);
	});
}
