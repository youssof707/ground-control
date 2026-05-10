import { Link } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { PermissionCard } from "./PermissionCard";

export function SessionChat({ sessionId }: { sessionId: string }) {
	const session = useSessionsStore((s) => s.sessions[sessionId]);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);

	if (!session) {
		return (
			<div className="page">
				<div className="message">Session not found.</div>
				<div style={{ marginTop: 12 }}>
					<Link to="/">← Back</Link>
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<header
				style={{
					padding: "12px 16px",
					borderBottom: "1px solid #e5e5ea",
					background: "#fff",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
					<Link to="/" style={{ fontSize: 13 }}>
						← All sessions
					</Link>
					<div style={{ fontWeight: 600 }}>{session.title}</div>
					<div style={{ fontSize: 12, color: "#86868b" }}>
						{session.id.slice(0, 8)} · {session.status}
					</div>
					{session.branch ? (
						<div
							style={{
								fontSize: 12,
								fontFamily: "monospace",
								color: "#1d1d1f",
								background: "#ececef",
								padding: "2px 8px",
								borderRadius: 4,
							}}
							title="Branch checked out when this session started"
						>
							{session.branch}
						</div>
					) : null}
				</div>
			</header>

			<div
				style={{
					flex: 1,
					overflow: "auto",
					padding: 16,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{session.messages.length === 0 && pending.length === 0 ? (
					<div className="message">Waiting for first message…</div>
				) : (
					session.messages.map((m) => (
						<div
							key={m.id}
							style={{
								border: "1px solid #e5e5ea",
								borderRadius: 6,
								padding: 8,
								background: "#fff",
							}}
						>
							<div
								style={{
									fontSize: 11,
									textTransform: "uppercase",
									color: "#86868b",
									letterSpacing: "0.04em",
									marginBottom: 4,
								}}
							>
								{m.role}
							</div>
							<pre
								style={{
									margin: 0,
									fontSize: 12,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									fontFamily:
										"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
								}}
							>
								{JSON.stringify(m.content, null, 2)}
							</pre>
						</div>
					))
				)}
				{pending.map((p) => (
					<PermissionCard key={p.requestId} req={p} />
				))}
			</div>
		</div>
	);
}
