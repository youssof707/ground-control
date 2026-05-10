import { Link } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { PermissionCard } from "./PermissionCard";

export function InboxPage() {
	const queue = usePermissionsStore((s) => s.queue);
	const sessions = useSessionsStore((s) => s.sessions);
	const ordered = [...queue].reverse();

	return (
		<div className="page">
			<header className="page-header">
				<div>
					<h1>Inbox</h1>
					<div className="page-subtitle">
						{queue.length === 0
							? "No pending questions."
							: `${queue.length} pending question${queue.length === 1 ? "" : "s"}.`}
					</div>
				</div>
			</header>

			{queue.length === 0 ? (
				<div className="message">All caught up.</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					{ordered.map((req) => {
						const sess = sessions[req.sessionId];
						return (
							<div
								key={req.requestId}
								style={{
									border: "1px solid #e5e5ea",
									borderRadius: 10,
									padding: 12,
									background: "#fff",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										marginBottom: 6,
									}}
								>
									<Link
										to={`/sessions/${req.sessionId}`}
										style={{ fontSize: 13, fontWeight: 500 }}
									>
										{sess?.title ?? req.sessionId.slice(0, 8)}
									</Link>
									<span style={{ fontSize: 12, color: "#86868b" }}>
										{new Date(req.createdAt).toLocaleTimeString()}
									</span>
								</div>
								<PermissionCard req={req} />
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
