import { Link, NavLink } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";

export function AppNav() {
	const count = usePermissionsStore((s) => s.queue.length);

	return (
		<nav
			style={{
				display: "flex",
				alignItems: "center",
				gap: 16,
				padding: "10px 16px",
				borderBottom: "1px solid #e5e5ea",
				background: "#fff",
				fontSize: 13,
			}}
		>
			<Link
				to="/"
				style={{
					fontWeight: 600,
					textDecoration: "none",
					color: "inherit",
				}}
			>
				Claude Code Wrapper
			</Link>
			<div style={{ display: "flex", gap: 12, marginLeft: 12 }}>
				<NavItem to="/" label="Sessions" />
				<NavItem to="/inbox" label="Inbox" badge={count} />
			</div>
		</nav>
	);
}

function NavItem({
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
				gap: 6,
				padding: "4px 10px",
				borderRadius: 6,
				textDecoration: "none",
				color: isActive ? "#1d1d1f" : "#6e6e73",
				background: isActive ? "#ececef" : "transparent",
			})}
		>
			{label}
			{badge && badge > 0 ? (
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						minWidth: 18,
						height: 18,
						padding: "0 5px",
						fontSize: 11,
						fontWeight: 600,
						color: "#fff",
						background: "#d93b3b",
						borderRadius: 9,
					}}
				>
					{badge}
				</span>
			) : null}
		</NavLink>
	);
}
