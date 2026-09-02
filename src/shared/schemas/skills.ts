import { z } from "zod";

/**
 * A personal global Claude skill — one directory under `~/.claude/skills/`,
 * described by its SKILL.md frontmatter. Read-only from the app's point of
 * view (skills are authored on disk, never created/edited here), so there
 * is no file schema and no create/update inputs. `name` doubles as the
 * slash command (`/{name}`) and as the React list key; the IPC handler
 * falls back to the directory name when frontmatter omits it.
 */
export const SkillSchema = z.object({
	name: z.string(),
	description: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;
