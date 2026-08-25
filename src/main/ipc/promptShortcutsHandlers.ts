import { ipcMain } from "electron";
import { ulid } from "ulid";
import * as promptShortcutsStore from "../core/store/prompt_shortcuts";
import { broadcast } from "../windows";
import {
	CreatePromptShortcutInputSchema,
	type CreatePromptShortcutInput,
	UpdatePromptShortcutInputSchema,
	type UpdatePromptShortcutInput,
} from "../../shared/schemas/promptShortcuts";

/**
 * IPC surface for saved in-session prompt shortcuts. Mirrors
 * shortcutsHandlers exactly, minus the `cwd` field: validation/trimming
 * happens here (not in the store); ids and timestamps are minted here;
 * every mutation ends with a skip-self `state:changed` broadcast because
 * the originating window applies the invoke result optimistically.
 *
 * Title is required here as well as in the input schema — `.min(1)` alone
 * would let a whitespace-only title through, and there's no cwd to fall
 * back on for the menu label.
 */
export function registerPromptShortcutsHandlers(): void {
	ipcMain.handle("promptShortcuts:list", () => promptShortcutsStore.list());

	ipcMain.handle(
		"promptShortcuts:create",
		async (e, rawInput: CreatePromptShortcutInput) => {
			const input = CreatePromptShortcutInputSchema.parse(rawInput);
			const title = input.title.trim();
			const prompt = input.prompt.trim();
			if (!title) throw new Error("Shortcut name is required");
			if (!prompt) throw new Error("Shortcut prompt is required");
			const shortcut = await promptShortcutsStore.create({
				id: ulid(),
				title,
				prompt,
				mode: input.mode,
				createdAt: Date.now(),
			});
			broadcast("state:changed", undefined, e.sender.id);
			return shortcut;
		},
	);

	ipcMain.handle(
		"promptShortcuts:update",
		async (e, rawInput: UpdatePromptShortcutInput) => {
			const input = UpdatePromptShortcutInputSchema.parse(rawInput);
			const title = input.title.trim();
			const prompt = input.prompt.trim();
			if (!title) throw new Error("Shortcut name is required");
			if (!prompt) throw new Error("Shortcut prompt is required");
			const updated = await promptShortcutsStore.update(input.id, {
				title,
				prompt,
				mode: input.mode,
			});
			if (!updated) throw new Error("Prompt shortcut not found");
			broadcast("state:changed", undefined, e.sender.id);
			return updated;
		},
	);

	ipcMain.handle("promptShortcuts:delete", async (e, id: string) => {
		await promptShortcutsStore.remove(id);
		broadcast("state:changed", undefined, e.sender.id);
	});
}
