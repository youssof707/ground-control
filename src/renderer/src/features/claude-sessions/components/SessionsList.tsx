import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";

// EDIT ME: absolute path to a real repo with a .git directory and source files.
const TEST_CWD = "/Users/youssof/Working Files/Code/claude-code-wrapper";

export function SessionsList() {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const navigate = useNavigate();
	const [startError, setStartError] = useState<string | null>(null);

	const runningCount = order.filter(
		(id) => sessions[id].status === "running",
	).length;

	const start = async () => {
		try {
			setStartError(null);
			const off = window.claude.on("session:started", (p) => {
				const s = p as { id: string };
				off();
				navigate(`/sessions/${s.id}`);
			});
			await window.claude.startSession({
				title: "Repo overview",
				prompt:
					"Look at the project structure and summarize what kind of app this is.",
				cwd: TEST_CWD,
			});
		} catch (err) {
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<div className="page">
			<header className="page-header">
				<div>
					<h1>Claude Code Wrapper</h1>
					<div className="page-subtitle">
						{order.length} session{order.length === 1 ? "" : "s"}
						{runningCount > 0 ? ` · ${runningCount} running` : ""}
					</div>
				</div>
				<button className="btn" onClick={start}>
					New Session
				</button>
			</header>

			{startError ? (
				<div className="message message-error" style={{ marginBottom: 12 }}>
					{startError}
				</div>
			) : null}

			{order.length === 0 ? (
				<div className="message">No sessions yet. Click “New Session”.</div>
			) : (
				<div className="table">
					<div
						className="table-header-row"
						style={{ gridTemplateColumns: "1fr 160px 120px 80px" }}
					>
						<div>Title</div>
						<div>Branch</div>
						<div>Status</div>
						<div>ID</div>
					</div>
					{order.map((id) => {
						const s = sessions[id];
						return (
							<Link
								key={id}
								to={`/sessions/${id}`}
								style={{ textDecoration: "none", color: "inherit" }}
							>
								<div
									className="table-row"
									style={{ gridTemplateColumns: "1fr 160px 120px 80px" }}
								>
									<div>{s.title}</div>
									<div
										style={{
											fontFamily: "monospace",
											fontSize: 12,
											color: s.branch ? "#1d1d1f" : "#86868b",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{s.branch ?? "—"}
									</div>
									<div>{s.status}</div>
									<div style={{ fontFamily: "monospace", fontSize: 12 }}>
										{s.id.slice(0, 8)}
									</div>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
