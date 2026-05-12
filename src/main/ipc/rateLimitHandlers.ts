import { ipcMain } from "electron";
import * as rateLimitTracker from "../sessions/RateLimitTracker";

/**
 * Read-only IPC for the renderer to rehydrate its in-memory snapshot of the
 * Claude.ai rate-limit state on mount. New events arrive via the
 * `rateLimit:update` broadcast from `RateLimitTracker.update`.
 */
export function registerRateLimitHandlers(): void {
	ipcMain.handle("rateLimit:get", () => rateLimitTracker.snapshot());
}
