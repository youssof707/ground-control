import { Link } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { DiffPage } from "./DiffRender";
import { T } from "../../../design/tokens";
import { BranchChipWithDelta } from "../../../design/Atoms";

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
		<Link
			to={`/sessions/${sessionId}`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				fontSize: 12.5,
				color: T.textDim,
				textDecoration: "none",
				padding: "5px 9px",
				borderRadius: 7,
				border: `0.5px solid ${T.border}`,
			}}
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path
					d="M7 3l-3 3 3 3"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			Back to chat
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
				background: T.win,
			}}
		>
			<header
				style={{
					padding: "12px 18px",
					borderBottom: `0.5px solid ${T.border}`,
					display: "flex",
					alignItems: "center",
					gap: 14,
				}}
			>
				{headerLink}
				<div
					style={{
						fontSize: 14,
						fontWeight: 600,
						color: T.text,
						maxWidth: 320,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{session.title}
				</div>
				<BranchChipWithDelta
					branch={session.branch}
					lastUserMessageBranch={session.lastUserMessageBranch}
				/>
				<div style={{ fontSize: 12, color: T.textFaint, fontFamily: T.mono }}>
					diff since {session.startCommit.slice(0, 8)}
				</div>
			</header>
			<div style={{ flex: 1, overflow: "auto", padding: 16, minHeight: 0 }}>
				<DiffPage diffText={session.diff} />
			</div>
		</div>
	);
}
