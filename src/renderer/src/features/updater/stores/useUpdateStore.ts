import { create } from "zustand";

/**
 * State machine for the update flow. All entry points (startup check, menu
 * "Check for Updates…", user clicking Install in the modal) mutate this
 * single store. The modal component reads it and derives its rendering.
 *
 *   idle          — no check in flight, no result to show
 *   checking      — GitHub API request in flight
 *   available     — check completed, newer version exists
 *   up-to-date    — check completed, we're on the latest (only shown when
 *                    triggered manually — startup checks close silently)
 *   downloading   — user clicked Install, DMG is downloading
 *   mounting      — DMG finished downloading, hdiutil is attaching
 *   installing    — swap script scheduled, app about to quit
 *   error         — network or install failure
 */
export type UpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "up-to-date"
	| "downloading"
	| "mounting"
	| "installing"
	| "error";

interface UpdateInfo {
	currentVersion: string;
	latestVersion: string;
	downloadUrl: string;
	releaseUrl: string;
	releaseNotes: string;
}

interface State {
	status: UpdateStatus;
	modalOpen: boolean;
	info: UpdateInfo | null;
	// 0-100 during download. Null when we're not downloading (indeterminate
	// phases like mounting show a spinner instead of a bar).
	progressPct: number | null;
	error: string | null;

	openModal: () => void;
	closeModal: () => void;
	setChecking: () => void;
	setAvailable: (info: UpdateInfo) => void;
	setUpToDate: (currentVersion: string) => void;
	setDownloading: () => void;
	setMounting: () => void;
	setInstalling: () => void;
	setProgress: (pct: number) => void;
	setError: (message: string) => void;
	reset: () => void;
}

export const useUpdateStore = create<State>((set) => ({
	status: "idle",
	modalOpen: false,
	info: null,
	progressPct: null,
	error: null,

	openModal: () => set({ modalOpen: true }),
	closeModal: () => set({ modalOpen: false }),
	setChecking: () =>
		set({ status: "checking", error: null, progressPct: null }),
	setAvailable: (info) =>
		set({ status: "available", info, modalOpen: true, error: null }),
	setUpToDate: (currentVersion) =>
		set({
			status: "up-to-date",
			info: {
				currentVersion,
				latestVersion: currentVersion,
				downloadUrl: "",
				releaseUrl: "",
				releaseNotes: "",
			},
			error: null,
		}),
	setDownloading: () => set({ status: "downloading", progressPct: 0 }),
	setMounting: () => set({ status: "mounting", progressPct: null }),
	setInstalling: () => set({ status: "installing", progressPct: null }),
	setProgress: (pct) => set({ progressPct: pct }),
	setError: (message) => set({ status: "error", error: message }),
	reset: () =>
		set({
			status: "idle",
			modalOpen: false,
			info: null,
			progressPct: null,
			error: null,
		}),
}));
