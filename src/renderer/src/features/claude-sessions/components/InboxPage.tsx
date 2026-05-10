import { Link } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { PermissionCard } from "./PermissionCard";
import { T } from "../../../design/tokens";
import { BranchChip, Eyebrow } from "../../../design/Atoms";

export function InboxPage() {
	const queue = usePermissionsStore((s) => s.queue);
	const sessions = useSessionsStore((s) => s.sessions);
	const ordered = [...queue].reverse();

	return (
		<div className="page">
			<header style={{ marginBottom: 24 }}>
				<Eyebrow style={{ marginBottom: 6 }}>Awaiting your input</Eyebrow>
				<h1 className="page-title">Inbox</h1>
				<div style={{ fontSize: 13, color: T.textDim }}>
					{queue.length === 0
						? "No pending questions."
						: `${queue.length} pending question${queue.length === 1 ? "" : "s"} · sessions pause until you respond.`}
				</div>
			</header>

			{ordered.length === 0 ? (
				<div
					style={{
						marginTop: 16,
						fontSize: 13,
						color: T.textFaint,
						textAlign: "center",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 12,
					}}
				>
					<span style={{ width: 24, height: 0.5, background: T.border }} />
					All caught up. Other sessions will queue here when they need you.
					<span style={{ width: 24, height: 0.5, background: T.border }} />
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					{ordered.map((req) => {
						const sess = sessions[req.sessionId];
						return (
							<div
								key={req.requestId}
								style={{
									borderRadius: 14,
									background: T.surface,
									border: `0.5px solid ${T.border}`,
									boxShadow: `0 0 0 4px ${T.accentSoft}, 0 8px 30px rgba(0,0,0,0.3)`,
									overflow: "hidden",
								}}
							>
								<div
									style={{
										padding: "12px 18px",
										borderBottom: `0.5px solid ${T.border}`,
										display: "flex",
										alignItems: "center",
										gap: 10,
									}}
								>
									<div style={{ fontSize: 12.5, color: T.textDim }}>
										From
									</div>
									<Link
										to={`/sessions/${req.sessionId}`}
										style={{
											fontSize: 13,
											color: T.info,
											fontWeight: 500,
											textDecoration: "none",
											display: "inline-flex",
											alignItems: "center",
											gap: 6,
										}}
									>
										{sess?.title ?? req.sessionId.slice(0, 8)}
										<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
											<path
												d="M3 2h5v5M3 7l5-5"
												stroke="currentColor"
												strokeWidth="1.4"
												strokeLinecap="round"
											/>
										</svg>
									</Link>
									<div style={{ flex: 1 }} />
									{sess?.branch ? <BranchChip name={sess.branch} /> : null}
									<span
										style={{
											fontSize: 12,
											color: T.textFaint,
											fontFamily: T.mono,
										}}
									>
										{new Date(req.createdAt).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
								</div>
								<div style={{ padding: 16 }}>
									<PermissionCard req={req} />
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
