import { Tray, nativeImage, type NativeImage } from "electron";

type Light = "idle" | "running" | "input";

const SIZE = 36;
const RADIUS = 11;

const COLORS: Record<Light, [number, number, number]> = {
	idle: [0, 0, 0],
	running: [94, 205, 134],
	input: [240, 200, 60],
};

let tray: Tray | null = null;
let shown: Light | null = null;
const busy = new Set<string>();
let pendingCount = 0;

function dot(light: Light): NativeImage {
	const [r, g, b] = COLORS[light];
	const pixels = Buffer.alloc(SIZE * SIZE * 4);
	const center = SIZE / 2;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
			const coverage = Math.min(1, Math.max(0, RADIUS + 0.5 - distance));
			const alpha = Math.round(coverage * 255);
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
	if (light === "idle") image.setTemplateImage(true);
	return image;
}

function currentLight(): Light {
	if (pendingCount > 0) return "input";
	if (busy.size > 0) return "running";
	return "idle";
}

function render(): void {
	if (!tray) return;
	const light = currentLight();
	if (light === shown) return;
	shown = light;
	tray.setImage(dot(light));
}

export function initMenuBarStatus(onClick: () => void): void {
	if (process.platform !== "darwin" || tray) return;
	shown = currentLight();
	tray = new Tray(dot(shown));
	tray.on("click", onClick);
}

export function setSessionBusy(id: string, isBusy: boolean): void {
	if (isBusy) busy.add(id);
	else busy.delete(id);
	render();
}

export function setPendingInputCount(count: number): void {
	pendingCount = count;
	render();
}
