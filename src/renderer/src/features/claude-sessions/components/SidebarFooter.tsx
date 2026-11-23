import { useEffect, useRef, useState } from "react";
import { T } from "../../../design/tokens";
import { RateLimitMeter } from "./RateLimitMeter";
import { TerminalsCard } from "./TerminalsCard";
import { BackgroundTasksIndicator } from "../../background-tasks/components/BackgroundTasksIndicator";

export function SidebarFooter() {
	const [appInfo, setAppInfo] = useState<{ env: "dev" | "prod" } | null>(
		null,
	);

	useEffect(() => {
		let alive = true;
		window.claude.getAppInfo().then((info) => {
			if (alive) setAppInfo(info);
		});
		return () => {
			alive = false;
		};
	}, []);

	const footerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const footer = footerRef.current;
		const pane = footer?.parentElement;
		if (!footer || !pane) return;
		const publishHeight = () =>
			pane.style.setProperty("--sidebar-footer-h", `${footer.offsetHeight}px`);
		const observer = new ResizeObserver(publishHeight);
		observer.observe(footer);
		publishHeight();
		return () => {
			observer.disconnect();
			pane.style.removeProperty("--sidebar-footer-h");
		};
	}, []);

	return (
		<div
			ref={footerRef}
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
			<TerminalsCard />
			<RateLimitMeter />
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					gap: 12,
					minHeight: 14,
				}}
			>
				<span
					onDoubleClick={() => {
						void window.claude.toggleDevTools();
					}}
					style={{
						flexShrink: 0,
						fontSize: 10,
						fontFamily: T.mono,
						color: T.textFaint,
						letterSpacing: 0.2,
					}}
				>
					v{__APP_VERSION__}
					{appInfo ? ` · ${appInfo.env}` : ""}
				</span>
				<BackgroundTasksIndicator />
			</div>
		</div>
	);
}
