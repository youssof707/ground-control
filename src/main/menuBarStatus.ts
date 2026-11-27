import { Tray, nativeImage, type NativeImage } from "electron";
import type { ScheduleStatusColor } from "../shared/schemas/schedules";

type SessionLight = "idle" | "running" | "input";
type Rgb = [number, number, number];

const SIZE = 36;
const DOT_RADIUS = 9;
const RING_OUTER = 17.5;
const RING_INNER = 12;

const WHITE: Rgb = [255, 255, 255];
const GREEN: Rgb = [86, 166, 118];
const YELLOW: Rgb = [204, 160, 82];
const RED: Rgb = [198, 92, 82];

const SESSION_COLORS: Record<SessionLight, Rgb> = {
	idle: WHITE,
	running: GREEN,
	input: YELLOW,
};

const TASK_COLORS: Record<ScheduleStatusColor, Rgb> = {
	green: GREEN,
	yellow: YELLOW,
	red: RED,
};

const TASK_RANK: Record<ScheduleStatusColor, number> = {
	green: 1,
	yellow: 2,
	red: 3,
};

let tray: Tray | null = null;
let shownKey: string | null = null;
const busy = new Set<string>();
let pendingSessionIds: string[] = [];
let isScheduledSession: (sessionId: string) => boolean = () => false;
const taskColorBySource = new Map<number, ScheduleStatusColor>();

function clamp01(n: number): number {
	return Math.min(1, Math.max(0, n));
}

function draw(session: SessionLight, task: ScheduleStatusColor | null): NativeImage {
	const template = session === "idle" && task === null;
	const dotRgb: Rgb = template ? [0, 0, 0] : SESSION_COLORS[session];
	const pixels = Buffer.alloc(SIZE * SIZE * 4);
	const center = SIZE / 2;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const d = Math.hypot(x + 0.5 - center, y + 0.5 - center);
			const dotCoverage = clamp01(DOT_RADIUS + 0.5 - d);
			const ringCoverage =
				task === null
					? 0
					: Math.min(
						clamp01(RING_OUTER + 0.5 - d),
						clamp01(d - RING_INNER + 0.5),
					);
			const onDot = dotCoverage >= ringCoverage;
			const [r, g, b] = onDot || task === null ? dotRgb : TASK_COLORS[task];
			const alpha = Math.round((onDot ? dotCoverage : ringCoverage) * 255);
			const i = (y * SIZE + x) * 4;
			pixels[i] = Math.round((b * alpha) / 255);
			pixels[i + 1] = Math.round((g * alpha) / 255);
			pixels[i + 2] = Math.round((r * alpha) / 255);
			pixels[i + 3] = alpha;
		}
	}
	const image = nativeImage.createFromBitmap(pixels, {
		width: SIZE,
		height: SIZE,
		scaleFactor: 2,
	});
	if (template) image.setTemplateImage(true);
	return image;
}

function sessionLight(): SessionLight {
	if (pendingSessionIds.some((id) => !isScheduledSession(id))) return "input";
	if (busy.size > 0) return "running";
	return "idle";
}

function taskColor(): ScheduleStatusColor | null {
	let worst: ScheduleStatusColor | null = null;
	for (const color of taskColorBySource.values()) {
		if (worst === null || TASK_RANK[color] > TASK_RANK[worst]) worst = color;
	}
	return worst;
}

function render(): void {
	if (!tray) return;
	const session = sessionLight();
	const task = taskColor();
	const key = `${session}:${task ?? "none"}`;
	if (key === shownKey) return;
	shownKey = key;
	tray.setImage(draw(session, task));
}

export function initMenuBarStatus(onClick: () => void): void {
	if (process.platform !== "darwin" || tray) return;
	tray = new Tray(draw(sessionLight(), taskColor()));
	shownKey = null;
	tray.on("click", onClick);
	render();
}

export function setScheduledSessionCheck(
	check: (sessionId: string) => boolean,
): void {
	isScheduledSession = check;
	render();
}

export function setSessionBusy(id: string, isBusy: boolean): void {
	if (isBusy && !isScheduledSession(id)) busy.add(id);
	else busy.delete(id);
	render();
}

export function setPendingInputSessions(sessionIds: string[]): void {
	pendingSessionIds = sessionIds;
	render();
}

export function setTaskColor(
	sourceId: number,
	color: ScheduleStatusColor | null,
): void {
	if (color === null) taskColorBySource.delete(sourceId);
	else taskColorBySource.set(sourceId, color);
	render();
}
