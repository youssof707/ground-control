import { useEffect, useState } from "react";
import { T } from "../../../design/tokens";
import { RateLimitMeter } from "./RateLimitMeter";

/**
 * Pinned to the bottom of the sessions sidebar pane (its parent supplies
 * `position: relative`). Houses the version/env chip and the rate-limit
 * meter as a single stacked footer with an opaque `T.win` background so
 * the sessions list scrolls *behind* it rather than colliding with two
 * free-floating fixed badges.
 *
 * Owns the `appInfo` fetch that previously lived in `MainApp` — moved here
 * because it's the only consumer.
 */
export function SidebarFooter() {
	const [appInfo, setAppInfo] = useState<{
		env: "dev" | "prod";
		storeFolder: string;
	} | null>(null);

	useEffect(() => {
		let alive = true;
		window.claude.getAppInfo().then((info) => {
			if (alive) setAppInfo(info);
		});
		return () => {
			alive = false;
		};
	}, []);

	return (
		<div
			style={{
				position: "absolute",
				left: 0,
				right: 0,
				bottom: 0,
				background: T.win,
				padding: "8px 14px 10px",
				display: "flex",
				flexDirection: "column",
				gap: 4,
				zIndex: 2,
				userSelect: "none",
			}}
		>
			<RateLimitMeter />
			<span
				title="Double-click to toggle DevTools"
				onDoubleClick={() => {
					void window.claude.toggleDevTools();
				}}
				style={{
					fontSize: 10,
					fontFamily: T.mono,
					color: T.textFaint,
					letterSpacing: 0.2,
				}}
			>
				v{__APP_VERSION__}
				{appInfo ? ` · ${appInfo.env} · ${appInfo.storeFolder}` : ""}
			</span>
		</div>
	);
}
