import { Link } from "react-router-dom";
import type {
	ClaudeSessionFull,
	PermissionRequest,
} from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useMinimizedPermissionsStore } from "../stores/useMinimizedPermissionsStore";
import { PermissionCard } from "./PermissionCard";
import { T } from "../../../design/tokens";
import {
	BranchChipWithDelta,
	Eyebrow,
	MinimizeToggle,
} from "../../../design/Atoms";

export function InboxSidebar({ onClose }: { onClose: () => void }) {
	const queue = usePermissionsStore((s) => s.queue);
	const sessions = useSessionsStore((s) => s.sessions);
	const ordered = [...queue].reverse();

	return (
		<aside
			style={{
				width: "30%",
				flexShrink: 0,
				height: "100%",
				display: "flex",
				flexDirection: "column",
				borderLeft: `0.5px solid ${T.border}`,
				background: T.win,
			}}
		>
			<header
				style={{
					flexShrink: 0,
					padding: "20px 20px 16px",
					display: "flex",
					alignItems: "flex-start",
					justifyContent: "space-between",
					gap: 12,
				}}
			>
				<div style={{ minWidth: 0 }}>
					<Eyebrow style={{ marginBottom: 6 }}>Awaiting your input</Eyebrow>
					<h1
						style={{
							margin: 0,
							fontSize: 20,
							fontWeight: 600,
							color: T.text,
							letterSpacing: "-0.3px",
						}}
					>
						Inbox
					</h1>
					<div style={{ fontSize: 12.5, color: T.textDim, marginTop: 4 }}>
						{queue.length === 0
							? "No pending questions."
							: `${queue.length} pending · sessions pause until you respond.`}
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close inbox"
					style={{
						flexShrink: 0,
						width: 28,
						height: 28,
						borderRadius: 8,
						border: `0.5px solid ${T.border}`,
						background: T.surface,
						color: T.textDim,
						cursor: "pointer",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<path
							d="M3 3l6 6M9 3l-6 6"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</header>

			<div
				style={{
					flex: 1,
					overflow: "auto",
					minHeight: 0,
					padding: "16px 16px 24px",
				}}
			>
				{ordered.length > 0 && (
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						{ordered.map((req) => (
							<InboxCard
								key={req.requestId}
								req={req}
								session={sessions[req.sessionId]}
							/>
						))}
					</div>
				)}
			</div>
		</aside>
	);
}

function InboxCard({
	req,
	session,
}: {
	req: PermissionRequest;
	session: ClaudeSessionFull | undefined;
}) {
	// Keyed on requestId (not sessionId): each inbox entry is one specific
	// request, so the user's "hide this card" choice should ride with that
	// request, not the whole session. Reuses the same persistent store as the
	// sessions-list row toggle; keys never collide (sessionId vs requestId are
	// distinct ULIDs) and stale entries are cheap.
	const minimized = useMinimizedPermissionsStore(
		(s) => s.minimized[req.requestId] ?? false,
	);
	const setMinimized = useMinimizedPermissionsStore((s) => s.setMinimized);

	return (
		<div
			style={{
				borderRadius: 12,
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "10px 14px",
					// Drop the bottom border when collapsed — otherwise it floats
					// without a body below it and looks like a stray line.
					borderBottom: minimized ? "none" : `0.5px solid ${T.border}`,
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexWrap: "wrap",
				}}
			>
				<div style={{ fontSize: 12, color: T.textDim }}>From</div>
				<Link
					to={`/sessions/${req.sessionId}`}
					style={{
						fontSize: 12.5,
						color: T.info,
						fontWeight: 500,
						textDecoration: "none",
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{session?.title ?? req.sessionId.slice(0, 8)}
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
				<BranchChipWithDelta
					branch={session?.branch}
					lastUserMessageBranch={session?.lastUserMessageBranch}
					showCurrentHint={false}
					suppressStale
				/>
				<span
					style={{
						fontSize: 11.5,
						color: T.textFaint,
						fontFamily: T.mono,
					}}
				>
					{new Date(req.createdAt).toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
				<MinimizeToggle
					minimized={minimized}
					onToggle={() => setMinimized(req.requestId, !minimized)}
					count={1}
				/>
			</div>
			{minimized ? null : (
				<div style={{ padding: 14 }}>
					<PermissionCard req={req} naked />
				</div>
			)}
		</div>
	);
}
