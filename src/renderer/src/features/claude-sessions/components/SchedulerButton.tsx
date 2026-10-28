import { T } from "../../../design/tokens";

export function SchedulerButton({
	armed,
	running,
	waiting,
	unread,
	open,
	onClick,
}: {
	armed: number;
	running: number;
	waiting: number;
	unread: number;
	open: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="btn"
			aria-haspopup="dialog"
			aria-expanded={open}
			onClick={onClick}
			style={{
				flex: 1,
				minWidth: 0,
				justifyContent: "flex-start",
				gap: 8,
				padding: "0 10px",
				color: open ? T.text : T.textDim,
				fontSize: 13,
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
				<circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.2" />
				<path
					d="M7 4v3.2l2.1 1.3"
					stroke="currentColor"
					strokeWidth="1.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span style={{ color: T.text, flexShrink: 0 }}>Schedules</span>
			<span
				style={{
					marginLeft: "auto",
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
				}}
			>
				{armed > 0 ? (
					<CountPill n={armed} fg={T.textDim} bg={T.surfaceHi} />
				) : null}
				{running > 0 ? <CountPill n={running} fg={T.ok} bg={T.okSoft} /> : null}
				{waiting > 0 ? (
					<CountPill n={waiting} fg={T.warn} bg={T.warnSoft} />
				) : null}
				{unread > 0 ? (
					<CountPill n={unread} fg={T.accent} bg={T.accentSoft} />
				) : null}
			</span>
		</button>
	);
}

export function CountPill({ n, fg, bg }: { n: number; fg: string; bg: string }) {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				minWidth: 16,
				height: 16,
				padding: "0 5px",
				borderRadius: 8,
				background: bg,
				color: fg,
				fontSize: 10,
				fontWeight: 600,
				fontFamily: T.mono,
				letterSpacing: "-0.2px",
				flexShrink: 0,
			}}
		>
			{n}
		</span>
	);
}
