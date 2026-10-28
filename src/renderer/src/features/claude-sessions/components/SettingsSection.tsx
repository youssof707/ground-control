import { T } from "../../../design/tokens";

export function Section({
	title,
	actions,
	children,
}: {
	title: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div style={{ marginBottom: 16 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
					minHeight: actions ? 24 : undefined,
					marginBottom: 8,
				}}
			>
				<div
					style={{
						fontSize: 10.5,
						fontWeight: 600,
						letterSpacing: 0.6,
						textTransform: "uppercase",
						color: T.textMute,
					}}
				>
					{title}
				</div>
				{actions ? (
					<div style={{ display: "flex", alignItems: "center", gap: 2 }}>{actions}</div>
				) : null}
			</div>
			{children}
		</div>
	);
}
