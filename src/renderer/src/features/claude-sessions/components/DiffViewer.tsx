import { Link } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { DiffPage } from "./DiffRender";

export function DiffViewer({ sessionId }: { sessionId: string }) {
	const session = useSessionsStore((s) => s.sessions[sessionId]);

	if (!session) {
		return (
			<div className="page">
				<div className="message">Session not found.</div>
			</div>
		);
	}

	const headerLink = (
		<Link to={`/sessions/${sessionId}`} style={{ fontSize: 13 }}>
			← Back to chat
		</Link>
	);

	if (session.status === "running") {
		return (
			<div className="page">
				{headerLink}
				<div className="message" style={{ marginTop: 12 }}>
					Diff updates each time Claude finishes a turn.
				</div>
			</div>
		);
	}

	if (!session.startCommit) {
		return (
			<div className="page">
				{headerLink}
				<div className="message" style={{ marginTop: 12 }}>
					{session.cwd} is not a git repo — no diff to show.
				</div>
			</div>
		);
	}

	if (!session.diff) {
		return (
			<div className="page">
				{headerLink}
				<div className="message" style={{ marginTop: 12 }}>
					No changes since session start.
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
				<div style={{ marginBottom: 4 }}>{headerLink}</div>
				<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
					<h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
						{session.title}
					</h1>
					<div style={{ fontSize: 12, color: "#86868b" }}>
						{session.branch ?? "(no branch)"} · diff since{" "}
						<code>{session.startCommit.slice(0, 8)}</code>
					</div>
				</div>
			</header>

			<div style={{ flex: 1, overflow: "auto", padding: 16 }}>
				<DiffPage diffText={session.diff} />
			</div>
		</div>
	);
}
