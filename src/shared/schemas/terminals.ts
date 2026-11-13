import { z } from "zod";

export const MAX_TERMINAL_GROUP_SIZE = 4;

export const TerminalStatusSchema = z.enum(["idle", "running", "crashed"]);

export const TerminalInfoSchema = z.object({
	id: z.string(),
	groupId: z.string(),
	cwd: z.string(),
	name: z.string().optional(),
	status: TerminalStatusSchema,
	lastLine: z.string(),
	lastLineAt: z.number(),
	exitCode: z.number().optional(),
	createdAt: z.number(),
});

export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;

export interface TerminalSnapshot {
	data: string;
	seq: number;
}

export interface TerminalDataEvent {
	id: string;
	data: string;
	seq: number;
}
