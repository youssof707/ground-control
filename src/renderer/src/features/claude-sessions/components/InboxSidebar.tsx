import { Link } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { PermissionCard } from "./PermissionCard";
import { T } from "../../../design/tokens";
import { BranchChip, Eyebrow } from "../../../design/Atoms";

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
					borderBottom: `0.5px solid ${T.border}`,
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
				{ordered.length === 0 ? (
					<div
						style={{
							marginTop: 16,
							fontSize: 12.5,
							color: T.textFaint,
							textAlign: "center",
							padding: "0 8px",
						}}
					>
						All caught up. Other sessions will queue here when they need you.
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						{ordered.map((req) => {
							const sess = sessions[req.sessionId];
							return (
								<div
									key={req.requestId}
									style={{
										borderRadius: 12,
										background: T.surface,
										border: `0.5px solid ${T.border}`,
										boxShadow: `0 0 0 3px ${T.accentSoft}, 0 6px 20px rgba(0,0,0,0.25)`,
										overflow: "hidden",
									}}
								>
									<div
										style={{
											padding: "10px 14px",
											borderBottom: `0.5px solid ${T.border}`,
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
									</div>
									<div style={{ padding: 14 }}>
										<PermissionCard req={req} />
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</aside>
	);
}
