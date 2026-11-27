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
		document.title = appInfo
			? `Ground Control v${__APP_VERSION__} · ${appInfo.env}`
			: "Ground Control";
	}, [appInfo]);

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
				background: T.sidebar,
				padding: "6px 2px 10px",
				display: "flex",
				flexDirection: "column",
				gap: 6,
				zIndex: 2,
				userSelect: "none",
			}}
		>
			<TerminalsCard />
			<div
				style={{
					height: 14,
					display: "flex",
					alignItems: "center",
					gap: 8,
				}}
			>
				<RateLimitMeter />
				<div
					style={{
						flexShrink: 0,
						marginLeft: "auto",
						display: "flex",
						justifyContent: "flex-end",
						paddingRight: 12,
					}}
				>
					<BackgroundTasksIndicator />
				</div>
			</div>
		</div>
	);
}
