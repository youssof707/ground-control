import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { PermissionCard } from "./PermissionCard";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { MessageView } from "./MessageView";

export function SessionChat({ sessionId }: { sessionId: string }) {
	const session = useSessionsStore((s) => s.sessions[sessionId]);
	const queue = usePermissionsStore((s) => s.queue);
	const pending = queue.filter((q) => q.sessionId === sessionId);
	const [interrupting, setInterrupting] = useState(false);
	const [resuming, setResuming] = useState(false);
	const [resumeError, setResumeError] = useState<string | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const messageCount = session?.messages.length ?? 0;
	const pendingCount = pending.length;

	const isOpen =
		session?.status === "running" ||
		session?.status === "idle" ||
		session?.status === "awaiting_permission";

	// Tick once a second while the session is open so the activity
	// indicator stays live without depending on store updates.
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!isOpen) return;
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [isOpen]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !stickToBottom.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messageCount, pendingCount]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		stickToBottom.current = distanceFromBottom < 80;
	};

	const stop = async () => {
		if (interrupting) return;
		setInterrupting(true);
		try {
			await window.claude.interruptSession(sessionId);
		} finally {
			setInterrupting(false);
		}
	};

	const resume = async () => {
		if (resuming) return;
		setResuming(true);
		setResumeError(null);
		try {
			await window.claude.resumeSession(sessionId);
		} catch (err) {
			setResumeError(err instanceof Error ? err.message : String(err));
		} finally {
			setResuming(false);
		}
	};

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
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 12,
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
					{isOpen ? (
						<ActivityChip
							session={session}
							hasPending={pending.length > 0}
							status={session.status}
						/>
					) : null}
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
				<div style={{ display: "flex", gap: 8 }}>
					{session.status === "running" ? (
						<button
							className="btn"
							onClick={stop}
							disabled={interrupting}
							style={{ fontSize: 13 }}
							title="Stop Claude's current response. The session stays open — you can keep sending messages."
						>
							{interrupting ? "Stopping…" : "Stop"}
						</button>
					) : null}
					{!isOpen && session.sdkSessionId ? (
						<button
							className="btn"
							onClick={resume}
							disabled={resuming}
							style={{ fontSize: 13 }}
							title="Resume this session and keep talking with the same context."
						>
							{resuming ? "Resuming…" : "Resume"}
						</button>
					) : null}
					{session.diff ? (
						<Link
							to={`/sessions/${sessionId}/diff`}
							className="btn"
							style={{ fontSize: 13, textDecoration: "none" }}
						>
							View diff
						</Link>
					) : null}
				</div>
			</header>

			<div
				ref={scrollRef}
				onScroll={onScroll}
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
					session.messages.map((m) => <MessageView key={m.id} m={m} />)
				)}
				{pending.map((p) => (
					<PermissionCard key={p.requestId} req={p} />
				))}
			</div>

			{resumeError ? (
				<div
					className="message message-error"
					style={{ margin: 12, padding: 8, fontSize: 12 }}
				>
					{resumeError}
				</div>
			) : null}
			{isOpen ? <ImagePasteTextarea sessionId={sessionId} /> : null}
		</div>
	);
}

function ActivityChip({
	session,
	hasPending,
	status,
}: {
	session: { messages: { ts: number }[]; createdAt: number };
	hasPending: boolean;
	status: string;
}) {
	if (hasPending) {
		return (
			<Chip color="#b07d00" bg="#fff8e6">
				● awaiting permission
			</Chip>
		);
	}
	if (status === "idle") {
		return (
			<Chip color="#6e6e73" bg="#ececef">
				○ waiting for input
			</Chip>
		);
	}

	const last =
		session.messages.length > 0
			? session.messages[session.messages.length - 1].ts
			: session.createdAt;
	const deltaSec = Math.max(0, Math.floor((Date.now() - last) / 1000));

	let color = "#2e8b3a";
	let bg = "#e9f5eb";
	let prefix = "active";
	if (deltaSec >= 120) {
		color = "#c92a2a";
		bg = "#fdecec";
		prefix = "no activity for";
	} else if (deltaSec >= 30) {
		color = "#b07d00";
		bg = "#fff8e6";
		prefix = "quiet";
	}

	return (
		<Chip color={color} bg={bg}>
			● {prefix} {formatDelta(deltaSec)}
		</Chip>
	);
}

function Chip({
	color,
	bg,
	children,
}: {
	color: string;
	bg: string;
	children: React.ReactNode;
}) {
	return (
		<div
			style={{
				fontSize: 12,
				color,
				background: bg,
				padding: "2px 8px",
				borderRadius: 999,
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{children}
		</div>
	);
}

function formatDelta(sec: number): string {
	if (sec < 5) return "just now";
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
