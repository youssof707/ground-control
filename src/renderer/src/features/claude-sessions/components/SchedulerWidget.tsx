import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Schedule, ScheduleStatusColor } from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { CountPill } from "../../../design/Atoms";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useReadStore } from "../stores/useReadStore";
import { isScheduledSession } from "../lib/scheduledSessions";
import { isSessionUnread } from "../lib/unread";
import { formatShortAgo } from "../lib/messageTime";
import {
	dismissScheduleAlert,
	scheduleSessionTarget,
	sortedScheduleAlerts,
} from "../lib/scheduleAlerts";
import { scheduleLabel } from "./SchedulesPanel";

const NOW_TICK_MS = 30_000;

const DOT: Record<ScheduleStatusColor, { fill: string; soft: string }> = {
	green: { fill: T.ok, soft: T.okSoft },
	yellow: { fill: T.warn, soft: T.warnSoft },
	red: { fill: T.danger, soft: T.dangerSoft },
};

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}

export function SchedulerWidget({
	open,
	onOpen,
	activeSessionId,
}: {
	open: boolean;
	onOpen: () => void;
	activeSessionId?: string;
}) {
	const navigate = useNavigate();
	const schedules = useSchedulesStore((s) => s.byId);
	const sessions = useSessionsStore((s) => s.sessions);
	const order = useSessionsStore((s) => s.order);
	const queue = usePermissionsStore((s) => s.queue);
	const lastReadAt = useReadStore((s) => s.lastReadAt);
	const now = useNow(NOW_TICK_MS);

	const counts = useMemo(() => {
		const armed = Object.values(schedules).filter(
			(s) => s.enabled && s.nextFireAt !== undefined,
		).length;
		const waiting = new Set(
			queue
				.filter((q) => isScheduledSession(sessions[q.sessionId]))
				.map((q) => q.sessionId),
		).size;
		return { armed, waiting };
	}, [schedules, sessions, queue]);

	const unreadByScheduleId = useMemo(() => {
		const map: Record<string, string[]> = {};
		for (const id of order) {
			const s = sessions[id];
			if (!s?.scheduleId) continue;
			if (!isSessionUnread(s, lastReadAt[id] ?? 0)) continue;
			(map[s.scheduleId] ??= []).push(id);
		}
		return map;
	}, [order, sessions, lastReadAt]);

	const runningScheduleIds = useMemo(() => {
		const ids = new Set<string>();
		for (const id of order) {
			const s = sessions[id];
			if (s?.scheduleId && s.status === "running") ids.add(s.scheduleId);
		}
		return ids;
	}, [order, sessions]);

	const alerts = useMemo(() => sortedScheduleAlerts(schedules), [schedules]);

	const activeScheduleId = activeSessionId
		? sessions[activeSessionId]?.scheduleId
		: undefined;

	const rows = useMemo(
		() =>
			Object.values(schedules)
				.filter(
					(s) =>
						s.id === activeScheduleId ||
						runningScheduleIds.has(s.id) ||
						(unreadByScheduleId[s.id]?.length ?? 0) > 0 ||
						(s.status !== undefined && s.alwaysShowStatus === true),
				)
				.sort((a, b) => a.createdAt - b.createdAt),
		[schedules, unreadByScheduleId, activeScheduleId, runningScheduleIds],
	);

	const openSchedule = (schedule: Schedule, preferredSessionId?: string) => {
		const target = scheduleSessionTarget(schedule, sessions, preferredSessionId);
		const unreadIds = unreadByScheduleId[schedule.id];
		if (unreadIds?.length) useReadStore.getState().markAllRead(unreadIds);
		if (target) navigate(`/sessions/${target}`);
	};

	const openAlert = (schedule: Schedule) => {
		dismissScheduleAlert(schedule);
		openSchedule(schedule, schedule.alert?.sessionId);
	};

	const hasBody = alerts.length > 0 || rows.length > 0;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 2,
				padding: 4,
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
			}}
		>
			<div
				className="sched-card-header"
				style={{
					display: "flex",
					alignItems: "center",
					height: 28,
					borderRadius: 5,
				}}
			>
				<button
					type="button"
					aria-haspopup="dialog"
					aria-expanded={open}
					onClick={onOpen}
					style={{
						...ROW_STYLE,
						flex: 1,
						height: "100%",
						paddingRight: 4,
						background: "transparent",
						color: open ? T.text : T.textDim,
						fontSize: 13,
						fontWeight: 500,
					}}
				>
					<IconSlot>
						<ClockIcon />
					</IconSlot>
					<span style={{ color: T.text, flexShrink: 0 }}>Schedules</span>
					{counts.armed > 0 ? (
						<span
							style={{
								marginLeft: -2,
								color: T.textMute,
								fontSize: 11,
								fontFamily: T.mono,
								flexShrink: 0,
							}}
						>
							{counts.armed}
						</span>
					) : null}
					<span
						style={{
							marginLeft: "auto",
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
						}}
					>
						{counts.waiting > 0 ? (
							<CountPill n={counts.waiting} fg={T.warn} bg={T.warnSoft} />
						) : null}
					</span>
				</button>
			</div>
			{hasBody ? (
				<>
					{alerts.map((s) => (
						<AlertRow
							key={s.id}
							schedule={s}
							onOpen={() => openAlert(s)}
							onDismiss={() => dismissScheduleAlert(s)}
						/>
					))}
					{rows.map((s) => (
						<StatusRow
							key={s.id}
							schedule={s}
							now={now}
							running={runningScheduleIds.has(s.id)}
							unread={unreadByScheduleId[s.id]?.length ?? 0}
							active={s.id === activeScheduleId}
							onClick={() => openSchedule(s)}
						/>
					))}
				</>
			) : null}
		</div>
	);
}

const ROW_STYLE = {
	appearance: "none",
	display: "flex",
	alignItems: "center",
	gap: 8,
	width: "100%",
	minWidth: 0,
	height: 28,
	padding: "0 8px",
	borderRadius: 5,
	border: "none",
	cursor: "pointer",
	textAlign: "left",
	fontSize: 12,
} as const;

const ELLIPSIS = {
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
} as const;

function AlertRow({
	schedule,
	onOpen,
	onDismiss,
}: {
	schedule: Schedule;
	onOpen: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				height: 28,
				borderRadius: 5,
				background: T.warnSoft,
				boxShadow: `inset 0 0 0 0.5px ${T.warnBorder}`,
			}}
		>
			<button
				type="button"
				className="sched-card-alert"
				onClick={onOpen}
				style={{
					...ROW_STYLE,
					flex: 1,
					height: "100%",
					paddingRight: 6,
					background: "transparent",
					color: T.warn,
				}}
			>
				<IconSlot>
					<WarningIcon />
				</IconSlot>
				<span
					style={{ ...ELLIPSIS, fontWeight: 500, flexShrink: 0, maxWidth: "40%" }}
				>
					{scheduleLabel(schedule)}
				</span>
				<span style={{ ...ELLIPSIS, flex: 1, color: T.text }}>
					{schedule.alert?.message}
				</span>
			</button>
			<button
				type="button"
				className="sched-card-dismiss"
				aria-label="Dismiss alert"
				onClick={onDismiss}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					flexShrink: 0,
					width: 16,
					height: 16,
					marginRight: 5,
					padding: 0,
					borderRadius: 4,
					background: "transparent",
					border: "none",
					color: T.warn,
					cursor: "pointer",
				}}
			>
				<CloseIcon />
			</button>
		</div>
	);
}

function StatusRow({
	schedule,
	now,
	running,
	unread,
	active,
	onClick,
}: {
	schedule: Schedule;
	now: number;
	running: boolean;
	unread: number;
	active: boolean;
	onClick: () => void;
}) {
	const status = schedule.status;
	return (
		<button
			type="button"
			className="sched-card-row"
			aria-current={active ? "page" : undefined}
			onClick={onClick}
			style={{
				...ROW_STYLE,
				background: active ? T.surfaceHi : "transparent",
				color: active ? T.textDim : T.textMute,
			}}
		>
			<IconSlot>
				{running ? (
					<span className="asyncy-btn-spinner sched-row-spinner" aria-hidden />
				) : status ? (
					<StatusDot color={status.color} />
				) : (
					<span style={{ display: "inline-flex", color: T.textFaint }}>
						<ClockIcon />
					</span>
				)}
			</IconSlot>
			<span
				style={{
					...ELLIPSIS,
					color: active ? T.text : T.textDim,
					flexShrink: 0,
					maxWidth: "40%",
				}}
			>
				{scheduleLabel(schedule)}
			</span>
			<span style={{ ...ELLIPSIS, flex: 1 }}>{status?.line}</span>
			{unread > 0 ? (
				<span
					style={{
						color: T.textFaint,
						fontSize: 10.5,
						fontFamily: T.mono,
						flexShrink: 0,
					}}
				>
					{unread}
				</span>
			) : null}
			<span
				style={{
					color: T.textFaint,
					fontSize: 10.5,
					fontFamily: T.mono,
					flexShrink: 0,
					minWidth: 22,
					textAlign: "right",
				}}
			>
				{status ? formatShortAgo(status.at, now) : null}
			</span>
		</button>
	);
}

function IconSlot({ children }: { children: ReactNode }) {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 14,
				flexShrink: 0,
			}}
		>
			{children}
		</span>
	);
}

export function StatusDot({
	color,
	pulse = false,
}: {
	color: ScheduleStatusColor;
	pulse?: boolean;
}) {
	const dot = DOT[color];
	return (
		<span
			aria-hidden
			style={{
				width: 6,
				height: 6,
				borderRadius: "50%",
				background: dot.fill,
				boxShadow: pulse ? `0 0 0 3px ${dot.soft}` : "none",
				flexShrink: 0,
			}}
		/>
	);
}

function ClockIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
			<circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M7 4v3.2l2.1 1.3"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function WarningIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
			<path
				d="M6 1.5L11 10.5H1L6 1.5Z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<path
				d="M6 5v2.5"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
			/>
			<circle cx="6" cy="9" r="0.6" fill="currentColor" />
		</svg>
	);
}

export function CloseIcon() {
	return (
		<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
			<path
				d="M1.5 1.5l5 5M6.5 1.5l-5 5"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
		</svg>
	);
}
