export const ACTIVITY_SOURCES = [
	"pmset",
	"caffeinate",
	"babysitter",
	"auto-resume",
	"schedule",
	"power",
] as const;

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export interface ActivityEntry {
	at: number;
	source: ActivitySource;
	message: string;
}

export interface ActivityLogSnapshot {
	path: string;
	entries: ActivityEntry[];
}

export interface CaffeinateProcess {
	pid: number;
	startedAt: number | null;
	args: string;
	ours: boolean;
	sessions: string[];
}
