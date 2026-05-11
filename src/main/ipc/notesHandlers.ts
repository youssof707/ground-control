import { ipcMain } from "electron";
import * as notesStore from "../core/store/session_notes";
import { broadcast } from "../windows";

export function registerNotesHandlers(): void {
	ipcMain.handle("notes:list", (_e, sessionId: string) =>
		notesStore.listForSession(sessionId),
	);
	ipcMain.handle("notes:create", async (e, sessionId: string) => {
		const note = await notesStore.create(sessionId);
		// Structural ping — other windows on this session refetch and pick up
		// the new note. Originator inserts optimistically from the return value.
		broadcast("state:changed", undefined, e.sender.id);
		return note;
	});
	ipcMain.handle(
		"notes:update",
		async (e, payload: { id: string; markdown: string }) => {
			const updated = await notesStore.update(payload.id, payload.markdown);
			// Skip-self ping. Other windows refetch the session's notes; the
			// in-flight guard in useSessionNotesStore protects local edits there.
			broadcast("state:changed", undefined, e.sender.id);
			return updated;
		},
	);
	ipcMain.handle("notes:delete", async (e, id: string) => {
		await notesStore.remove(id);
		broadcast("state:changed", undefined, e.sender.id);
	});
}
