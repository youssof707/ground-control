import { useEffect } from "react";
import { useUpdateStore } from "../stores/useUpdateStore";

/**
 * Wires up the update flow:
 *   1. Silent check ~2s after mount (giving the app time to hydrate first).
 *      If an update exists, the store opens the modal automatically.
 *      If not, we stay silent — no toast, no interruption.
 *   2. Listens for `updater:menu-triggered` from the main-process menu item.
 *      Runs the same check but *always* shows the modal, even for the
 *      up-to-date case, so the user gets visible feedback for their click.
 *   3. Listens for `updater:progress` and `updater:status` events during
 *      install and feeds them into the store.
 *
 * Mounted once at the app root (via MainApp).
 */
export function useUpdater() {
	const setChecking = useUpdateStore((s) => s.setChecking);
	const setAvailable = useUpdateStore((s) => s.setAvailable);
	const setUpToDate = useUpdateStore((s) => s.setUpToDate);
	const setDownloading = useUpdateStore((s) => s.setDownloading);
	const setMounting = useUpdateStore((s) => s.setMounting);
	const setInstalling = useUpdateStore((s) => s.setInstalling);
	const setProgress = useUpdateStore((s) => s.setProgress);
	const setError = useUpdateStore((s) => s.setError);
	const openModal = useUpdateStore((s) => s.openModal);

	useEffect(() => {
		let cancelled = false;

		async function runCheck(opts: { silent: boolean }): Promise<void> {
			setChecking();
			try {
				const result = await window.claude.checkForUpdate();
				if (cancelled) return;
				if (result.error) {
					// Only surface the error UI when the user explicitly asked
					// for a check. A background failure (offline, GH ratelimit)
					// shouldn't nag them.
					if (!opts.silent) setError(result.error);
					return;
				}
				if (result.available && result.downloadUrl) {
					setAvailable({
						currentVersion: result.currentVersion,
						latestVersion: result.latestVersion ?? "",
						downloadUrl: result.downloadUrl,
						releaseUrl: result.releaseUrl ?? "",
						releaseNotes: result.releaseNotes ?? "",
					});
				} else {
					setUpToDate(result.currentVersion);
					if (!opts.silent) openModal();
				}
			} catch (err) {
				if (cancelled) return;
				if (!opts.silent) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		// Kick off the startup check after a short delay so we don't compete
		// with the initial hydration burst.
		const startupTimer = setTimeout(() => {
			void runCheck({ silent: true });
		}, 2000);

		const offs = [
			window.claude.on("updater:menu-triggered", () => {
				void runCheck({ silent: false });
			}),
			window.claude.on("updater:progress", (p) => {
				const payload = p as { percent: number };
				setProgress(payload.percent);
			}),
			window.claude.on("updater:status", (p) => {
				const payload = p as {
					phase: "downloading" | "mounting" | "installing";
				};
				if (payload.phase === "downloading") setDownloading();
				else if (payload.phase === "mounting") setMounting();
				else if (payload.phase === "installing") setInstalling();
			}),
		];

		return () => {
			cancelled = true;
			clearTimeout(startupTimer);
			offs.forEach((off) => off());
		};
	}, [
		setChecking,
		setAvailable,
		setUpToDate,
		setDownloading,
		setMounting,
		setInstalling,
		setProgress,
		setError,
		openModal,
	]);
}
