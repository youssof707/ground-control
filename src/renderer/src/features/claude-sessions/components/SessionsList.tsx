import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { ConfirmModal } from "../../../components/ConfirmModal";

// EDIT ME: absolute path to a real repo with a .git directory and source files.
const TEST_CWD = "/Users/youssof/Working Files/Code/gamestudio";

const COLS = "1fr 160px 120px 80px 32px";

export function SessionsList() {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const removeSession = useSessionsStore((s) => s.removeSession);
	const navigate = useNavigate();
	const [startError, setStartError] = useState<string | null>(null);

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

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
				title: `Session ${order.length + 1}`,
				cwd: TEST_CWD,
			});
		} catch (err) {
			setStartError(err instanceof Error ? err.message : String(err));
		}
	};

	const confirmDelete = async () => {
		if (!pendingDeleteId || deleting) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await window.claude.deleteSession(pendingDeleteId);
			removeSession(pendingDeleteId);
			setPendingDeleteId(null);
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeleting(false);
		}
	};

	const cancelDelete = () => {
		if (deleting) return;
		setPendingDeleteId(null);
		setDeleteError(null);
	};

	const pendingDeleteSession = pendingDeleteId
		? sessions[pendingDeleteId]
		: null;

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
						style={{ gridTemplateColumns: COLS }}
					>
						<div>Title</div>
						<div>Branch</div>
						<div>Status</div>
						<div>ID</div>
						<div />
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
									style={{ gridTemplateColumns: COLS }}
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
									<button
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setPendingDeleteId(id);
											setDeleteError(null);
										}}
										title="Delete this session from the app"
										style={{
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											width: 24,
											height: 24,
											border: "none",
											background: "transparent",
											color: "#86868b",
											cursor: "pointer",
											borderRadius: 4,
											fontSize: 14,
											lineHeight: 1,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = "#fdecec";
											e.currentTarget.style.color = "#c92a2a";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = "transparent";
											e.currentTarget.style.color = "#86868b";
										}}
									>
										✕
									</button>
								</div>
							</Link>
						);
					})}
				</div>
			)}

			<ConfirmModal
				open={!!pendingDeleteId}
				title="Delete session?"
				message={
					<>
						Remove{" "}
						<strong>
							{pendingDeleteSession?.title ?? "this session"}
						</strong>{" "}
						from this app. Claude Code's own session history (in{" "}
						<code>~/.claude</code>) is not affected.
					</>
				}
				confirmLabel="Delete"
				cancelLabel="Cancel"
				destructive
				busy={deleting}
				error={deleteError}
				onConfirm={confirmDelete}
				onCancel={cancelDelete}
			/>
		</div>
	);
}
