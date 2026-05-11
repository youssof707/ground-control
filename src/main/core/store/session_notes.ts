import * as fs from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import writeFileAtomic from "write-file-atomic";
import {
	NoteSchema,
	SessionNotesFileSchema,
	type Note,
	type SessionNotesFile,
} from "../../../shared/schemas/session_notes";
import { enqueue } from "./write_queue";

let initialized = false;
let filePath: string | null = null;
let db: SessionNotesFile = { notes: {} };

function assertInitialized(): void {
	if (!initialized) {
		throw new Error(
			"SessionNotes store not initialized. Call initialize(dataDir) first.",
		);
	}
}

async function readJsonOrNull(p: string): Promise<unknown | null> {
	try {
		const text = await fs.readFile(p, "utf8");
		return JSON.parse(text);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

async function persist(): Promise<void> {
	if (!filePath) throw new Error("filePath not set");
	await writeFileAtomic(filePath, JSON.stringify(db, null, 2));
}

export async function initialize(dataDir: string): Promise<void> {
	await fs.mkdir(dataDir, { recursive: true });
	filePath = path.join(dataDir, "session_notes.json");

	const raw = await readJsonOrNull(filePath);
	if (raw === null) {
		const empty: SessionNotesFile = { notes: {} };
		await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
		db = empty;
	} else {
		db = SessionNotesFileSchema.parse(raw);
	}

	initialized = true;
}

export function listForSession(sessionId: string): Note[] {
	assertInitialized();
	return Object.values(db.notes)
		.filter((n) => n.sessionId === sessionId)
		.map((n) => structuredClone(n));
}

export async function create(sessionId: string): Promise<Note> {
	assertInitialized();
	return enqueue(async () => {
		const now = Date.now();
		const note: Note = NoteSchema.parse({
			id: ulid(),
			sessionId,
			markdown: "",
			createdAt: now,
			updatedAt: now,
		});
		db.notes[note.id] = note;
		await persist();
		return structuredClone(note);
	});
}

export async function update(
	id: string,
	markdown: string,
): Promise<Note | null> {
	assertInitialized();
	return enqueue(async () => {
		const current = db.notes[id];
		// Tolerate missing rows: a note can be deleted concurrently in another
		// window while this one had a debounced save in flight.
		if (!current) return null;
		const merged: Note = NoteSchema.parse({
			...current,
			markdown,
			updatedAt: Date.now(),
		});
		db.notes[id] = merged;
		await persist();
		return structuredClone(merged);
	});
}

export async function remove(id: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		if (!db.notes[id]) return;
		delete db.notes[id];
		await persist();
	});
}

/**
 * Cascade-delete all notes belonging to a session. Called from
 * `session:delete` so the session record and its notes are removed
 * atomically (the shared write queue serializes both writes).
 */
export async function deleteAllForSession(sessionId: string): Promise<void> {
	assertInitialized();
	return enqueue(async () => {
		let mutated = false;
		for (const id of Object.keys(db.notes)) {
			if (db.notes[id].sessionId === sessionId) {
				delete db.notes[id];
				mutated = true;
			}
		}
		if (mutated) await persist();
	});
}
