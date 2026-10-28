import { useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import { StatusPill } from "../../../design/Atoms";
import { T } from "../../../design/tokens";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { isScheduledSession } from "../lib/scheduledSessions";
import { deleteSessionWithUndo } from "../lib/deleteSessionActions";
import { formatMessageTime } from "../lib/messageTime";
import { BabysitBadge } from "./BabysitBadge";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { scheduleLabel } from "./SchedulesPanel";

const ROW_SELECTED_BG = `color-mix(in oklab, ${T.text} 4%, transparent)`;

export function ScheduledSessionsPanel({
	onOpenSession,
}: {
	onOpenSession: (sessionId: string) => void;
}) {
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const schedules = useSchedulesStore((s) => s.byId);

	const groups = useMemo(() => {
		const scheduled = order
			.map((id) => sessions[id])
			.filter((s): s is ClaudeSessionFull => !!s && isScheduledSession(s))
			.sort((a, b) => b.createdAt - a.createdAt);
		const byScheduleId = new Map<string, ClaudeSessionFull[]>();
		for (const s of scheduled) {
			const key = s.scheduleId ?? "";
			const list = byScheduleId.get(key);
			if (list) list.push(s);
			else byScheduleId.set(key, [s]);
		}
		return Array.from(byScheduleId.entries()).map(([scheduleId, list]) => ({
			scheduleId,
			title: schedules[scheduleId]
				? scheduleLabel(schedules[scheduleId])
				: "Deleted schedule",
			sessions: list,
		}));
	}, [order, sessions, schedules]);

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
				<div key={g.scheduleId}>
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
	onOpen,
}: {
	session: ClaudeSessionFull;
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
					<span>{formatMessageTime(session.createdAt)}</span>
				</span>
			</div>
			<div onClick={stop} onKeyDown={stop} style={{ flexShrink: 0 }}>
				<ConfirmDeleteButton label="run" onDelete={remove} />
			</div>
		</div>
	);
}
