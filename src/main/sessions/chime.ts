import { execFile } from "node:child_process";

const AFPLAY = "/usr/bin/afplay";
const CHIME_SOUND = "/System/Library/Sounds/Submarine.aiff";

export function playChime(): void {
	execFile(AFPLAY, [CHIME_SOUND], (err) => {
		if (err) console.warn("[chime] afplay failed:", err.message);
	});
}
