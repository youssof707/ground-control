import { Link, NavLink } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { T } from "../../../design/tokens";

export function AppNav() {
	const count = usePermissionsStore((s) => s.queue.length);

	return (
		<nav
			style={{
				height: 52,
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				gap: 4,
				padding: "0 18px",
				borderBottom: `0.5px solid ${T.border}`,
				background: T.win,
			}}
		>
			<Link
				to="/"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginRight: 18,
					textDecoration: "none",
				}}
			>
				<Logo />
				<span
					style={{
						fontSize: 13.5,
						fontWeight: 600,
						color: T.text,
						letterSpacing: "-0.1px",
					}}
				>
					Claude Code
				</span>
			</Link>
			<div
				style={{
					width: 1,
					height: 18,
					background: T.border,
					marginRight: 8,
				}}
			/>
			<Tab to="/" label="Sessions" />
			<Tab to="/inbox" label="Inbox" badge={count} />
		</nav>
	);
}

function Tab({
	to,
	label,
	badge,
}: {
	to: string;
	label: string;
	badge?: number;
}) {
	return (
		<NavLink
			to={to}
			end
			style={({ isActive }) => ({
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 12px",
				borderRadius: 8,
				fontSize: 13,
				fontWeight: 500,
				color: isActive ? T.text : T.textMute,
				background: isActive ? T.surface : "transparent",
				boxShadow: isActive ? `inset 0 0 0 0.5px ${T.border}` : "none",
				textDecoration: "none",
			})}
		>
			{({ isActive }) => (
				<>
					<span>{label}</span>
					{badge && badge > 0 ? (
						<span
							style={{
								minWidth: 18,
								height: 18,
								padding: "0 6px",
								borderRadius: 9,
								background: isActive ? T.accent : T.accentSoft,
								color: isActive ? T.accentInk : T.accent,
								fontSize: 11,
								fontWeight: 600,
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								fontFamily: T.mono,
								letterSpacing: "-0.2px",
							}}
						>
							{badge}
						</span>
					) : null}
				</>
			)}
		</NavLink>
	);
}

function Logo() {
	return (
		<div
			style={{
				width: 22,
				height: 22,
				borderRadius: 6,
				background: T.accentSoft,
				border: `0.5px solid ${T.accentBorder}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: T.accent,
				fontFamily: T.mono,
				fontSize: 11,
				fontWeight: 700,
				letterSpacing: "-0.5px",
			}}
		>
			{"</>"}
		</div>
	);
}
