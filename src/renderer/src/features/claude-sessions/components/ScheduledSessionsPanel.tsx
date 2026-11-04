import { useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { StatusPill } from "../../../design/Atoms";
import { T } from "../../../design/tokens";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { isScheduledSession } from "../lib/scheduledSessions";
import { isSessionUnread, lastIncomingMessageText } from "../lib/unread";
import { useReadStore } from "../stores/useReadStore";
import { deleteSessionWithUndo } from "../lib/deleteSessionActions";
import { formatMessageTime } from "../lib/messageTime";
import { BabysitBadge } from "./BabysitBadge";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

const ROW_SELECTED_BG = `color-mix(in oklab, ${T.text} 4%, transparent)`;

export function ScheduledSessionsPanel({
	onOpenSession,
}: {
	onOpenSession: (sessionId: string) => void;
}) {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const lastReadAt = useReadStore((s) => s.lastReadAt);

	const groups = useMemo(() => {
		const scheduled = order
			.map((id) => sessions[id])
			.filter((s): s is ClaudeSessionFull => !!s && isScheduledSession(s))
			.sort((a, b) => b.createdAt - a.createdAt);
		const unread: ClaudeSessionFull[] = [];
		const read: ClaudeSessionFull[] = [];
		for (const s of scheduled) {
			if (isSessionUnread(s, lastReadAt[s.id] ?? 0)) unread.push(s);
			else read.push(s);
		}
		return [
			{ key: "unread", title: "Unread", unread: true, sessions: unread },
			{ key: "read", title: "Read", unread: false, sessions: read },
		].filter((g) => g.sessions.length > 0);
	}, [order, sessions, lastReadAt]);

	if (groups.length === 0) {
		return (
			<div
				style={{
					padding: "28px 0",
					textAlign: "center",
					fontSize: 12.5,
					color: T.textMute,
				}}
			>
				No logs yet.
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{groups.map((g) => (
				<div key={g.key}>
					<div
						style={{
							fontSize: 10.5,
							fontWeight: 600,
							letterSpacing: 0.6,
							textTransform: "uppercase",
							color: T.textMute,
							marginBottom: 8,
						}}
					>
						{g.title}
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						{g.sessions.map((s) => (
							<ScheduledSessionRow
								key={s.id}
								session={s}
								unread={g.unread}
								onOpen={() => onOpenSession(s.id)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function ScheduledSessionRow({
	session,
	unread,
	onOpen,
}: {
	session: ClaudeSessionFull;
	unread: boolean;
	onOpen: () => void;
}) {
	const [hover, setHover] = useState(false);
	const navigate = useNavigate();
	const match = useMatch("/sessions/:id/*");
	const active = match?.params.id === session.id;
	const pending = usePermissionsStore((s) =>
		s.queue.find((q) => q.sessionId === session.id),
	);
	const status = pending ? "awaiting_permission" : session.status;
	const preview = useMemo(
		() => (unread ? lastIncomingMessageText(session) : ""),
		[unread, session],
	);

	const remove = async () => {
		await deleteSessionWithUndo(session.id);
		if (active) navigate("/");
	};

	const stop = (e: React.SyntheticEvent) => e.stopPropagation();

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onOpen}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				textAlign: "left",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "7px 8px 7px 12px",
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: active ? ROW_SELECTED_BG : hover ? T.surfaceHi : T.surface,
				color: T.text,
				cursor: "pointer",
				fontSize: 12.5,
				transition: "background 80ms ease, border-color 80ms ease",
				outline: "none",
			}}
		>
			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: "flex",
					flexDirection: "column",
					gap: 4,
				}}
			>
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						minWidth: 0,
					}}
				>
					{unread ? (
						<span
							aria-label="Unread"
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: T.accent,
								flexShrink: 0,
							}}
						/>
					) : null}
					<span
						style={{
							fontWeight: 600,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{session.title || "Untitled"}
					</span>
					<span
						style={{
							fontSize: 11,
							fontWeight: 400,
							color: T.textMute,
							flexShrink: 0,
						}}
					>
						{formatMessageTime(session.createdAt)}
					</span>
				</span>
				{preview ? (
					<span
						style={{
							fontSize: 12,
							lineHeight: 1.45,
							color: T.textDim,
							whiteSpace: "pre-wrap",
							overflowWrap: "anywhere",
							display: "-webkit-box",
							WebkitLineClamp: 4,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}
					>
						{preview}
					</span>
				) : null}
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 11,
						color: T.textMute,
					}}
				>
					<StatusPill
						status={status}
						mode={session.mode}
						pendingToolName={pending?.toolName}
					/>
					<BabysitBadge sessionId={session.id} />
				</span>
			</div>
			<div onClick={stop} onKeyDown={stop} style={{ flexShrink: 0 }}>
				<ConfirmDeleteButton label="run" onDelete={remove} />
			</div>
		</div>
	);
}
