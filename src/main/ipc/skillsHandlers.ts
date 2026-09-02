import { ipcMain, shell } from "electron";
import { mkdir, readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { Skill } from "../../shared/schemas/skills";

const SKILLS_DIR = join(homedir(), ".claude", "skills");

/**
 * IPC surface for the user's personal global Claude skills: the
 * directories under `~/.claude/skills/`, each described by a SKILL.md
 * with YAML frontmatter. Deliberately scoped to that one directory —
 * not project skills, not plugins.
 *
 * Unlike shortcuts there is no core/store module, no write queue and no
 * broadcast: skills are read-only and live on disk outside the app's
 * data dir, so every `skills:list` invoke re-reads the directory — that
 * IS the refresh (the renderer calls it at boot and on every modal open,
 * rendering its in-memory copy in the meantime).
 */
export function registerSkillsHandlers(): void {
	ipcMain.handle("skills:list", () => listSkills());
	ipcMain.handle("skills:openFolder", () => openSkillsFolder());
}

/**
 * Opens `~/.claude/skills` in Finder. Creates the directory first if it
 * doesn't exist yet (fresh machine, no skills written) so the entry point
 * always lands somewhere real instead of erroring.
 */
async function openSkillsFolder(): Promise<void> {
	await mkdir(SKILLS_DIR, { recursive: true });
	const message = await shell.openPath(SKILLS_DIR);
	if (message) throw new Error(message);
}

async function listSkills(): Promise<Skill[]> {
	const dir = SKILLS_DIR;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err) {
		// No skills dir is a normal state (fresh machine, skills removed) —
		// return an empty list. Anything else (permissions, IO) throws so
		// the renderer's catch keeps its stale in-memory list instead of
		// hydrating an incorrectly-empty one.
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}

	const skills: Skill[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		// Per-entry try/catch: a skill dir without a readable SKILL.md is
		// skipped, never fatal to the whole list.
		try {
			const text = await readFile(join(dir, entry.name, "SKILL.md"), "utf8");
			const fm = parseFrontmatter(text);
			skills.push({
				name: fm.name ?? entry.name,
				description: fm.description ?? "",
			});
		} catch {
			continue;
		}
	}
	skills.sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);
	return skills;
}

/**
 * Minimal frontmatter reader — the repo has no YAML dependency and skill
 * frontmatter in practice uses plain single-line scalars for `name` and
 * `description`. Multi-line/nested values fall through to the caller's
 * fallbacks (directory name / empty description).
 */
function parseFrontmatter(text: string): {
	name?: string;
	description?: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!match) return {};
	const body = match[1];
	return {
		name: extractScalar(body, "name"),
		description: extractScalar(body, "description"),
	};
}

function extractScalar(body: string, key: string): string | undefined {
	const m = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(body);
	if (!m) return undefined;
	let value = m[1].trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value.length > 0 ? value : undefined;
}
