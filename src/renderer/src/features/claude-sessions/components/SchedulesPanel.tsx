import { useEffect, useRef, useState } from "react";
import type { Schedule } from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { useScheduleControls } from "../hooks/useScheduleControls";
import { formatMessageTime } from "../lib/messageTime";
import { formatScheduleKind } from "../lib/scheduleFormat";
import { StatusDot } from "./SchedulerWidget";
import { Switch } from "../../../design/Switch";
import { promptPreview } from "./ShortcutForm";

export function scheduleLabel(s: Schedule): string {
	return s.title.trim() || promptPreview(s.prompt) || "Untitled task";
}

export function SchedulesPanel({
	now,
	onEdit,
	onOpenSession,
}: {
	now: number;
	onEdit: (schedule: Schedule) => void;
	onOpenSession: (sessionId: string) => void;
}) {
	const byId = useSchedulesStore((s) => s.byId);
	const list = Object.values(byId).sort((a, b) => {
		const an = a.nextFireAt ?? Number.POSITIVE_INFINITY;
		const bn = b.nextFireAt ?? Number.POSITIVE_INFINITY;
		return an - bn || b.createdAt - a.createdAt;
	});
	if (list.length === 0) {
		return (
			<div
				style={{
					padding: "28px 0",
					textAlign: "center",
					fontSize: 12.5,
					color: T.textMute,
				}}
			>
				No tasks yet.
			</div>
		);
	}
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{list.map((s) => (
				<ScheduleRow
					key={s.id}
					schedule={s}
					now={now}
					onEdit={() => onEdit(s)}
					onOpenSession={onOpenSession}
				/>
			))}
		</div>
	);
}

function ScheduleRow({
	schedule,
	now,
	onEdit,
	onOpenSession,
}: {
	schedule: Schedule;
	now: number;
	onEdit: () => void;
	onOpenSession: (sessionId: string) => void;
}) {
	const [hover, setHover] = useState(false);
	const {
		error,
		lastSession,
		running,
		stopping,
		canStop,
		setEnabled,
		runNow,
		stopRun,
		remove,
		clearStatus,
	} = useScheduleControls(schedule);
	const targetId = lastSession?.id;
	const open = targetId ? () => onOpenSession(targetId) : undefined;
	const stop = (e: React.SyntheticEvent) => e.stopPropagation();
	const shownError = error ?? schedule.lastError;
	const skippedRecently =
		schedule.lastSkippedAt !== undefined &&
		schedule.lastSkippedAt > (schedule.lastFiredAt ?? 0);

	return (
		<div
			role={open ? "button" : undefined}
			tabIndex={open ? 0 : undefined}
			onClick={open}
			onKeyDown={(e) => {
				if (open && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					open();
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
				padding: "8px 8px 8px 12px",
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				background: hover && open ? "oklch(0.23 0.0075 60)" : T.surface,
				color: T.text,
				cursor: open ? "pointer" : "default",
				fontSize: 12.5,
				transition: "background 80ms ease",
				outline: "none",
				opacity: schedule.enabled ? 1 : 0.7,
			}}
		>
			<span
				style={{
					display: "inline-flex",
					width: 12,
					justifyContent: "center",
					flexShrink: 0,
				}}
			>
				{schedule.status ? (
					<StatusDot color={schedule.status.color} pulse={running} />
				) : (
					<span
						aria-hidden
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: T.textFaint,
						}}
					/>
				)}
			</span>
			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: "flex",
					flexDirection: "column",
					gap: 3,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: 8,
						minWidth: 0,
					}}
				>
					<span
						style={{
							fontWeight: 600,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							minWidth: 0,
						}}
					>
						{scheduleLabel(schedule)}
					</span>
					<span
						style={{
							fontSize: 11,
							color: T.textFaint,
							whiteSpace: "nowrap",
							flexShrink: 0,
						}}
					>
						{formatScheduleKind(schedule.kind, now)}
					</span>
				</div>
				<span
					style={{
						fontSize: 11,
						color: shownError ? T.danger : T.textDim,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{shownError ??
						(running
							? "Running…"
							: (schedule.status?.line ?? "No status yet"))}
				</span>
				{schedule.lastFiredAt || schedule.lastSkippedAt ? (
					<span style={{ fontSize: 11, color: T.textFaint }}>
						{schedule.lastFiredAt
							? `Last run ${formatMessageTime(schedule.lastFiredAt)}`
							: "Not run yet"}
						{skippedRecently
							? ` · skipped ${formatMessageTime(schedule.lastSkippedAt ?? 0)} (${
								schedule.lastSkipReason === "usageLimit"
									? "usage limit"
									: "still running"
							})`
							: ""}
					</span>
				) : null}
			</div>
			<div
				onClick={stop}
				onKeyDown={stop}
				style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
			>
				<Switch
					label={schedule.enabled ? "Turn task off" : "Turn task on"}
					checked={schedule.enabled}
					onChange={(next) => void setEnabled(next)}
				/>
				<ScheduleMenu
					running={running}
					stopping={stopping}
					onRunNow={() => void runNow()}
					onStop={canStop ? () => void stopRun() : undefined}
					onEdit={onEdit}
					hasStatus={!!schedule.status}
					onClearStatus={() => void clearStatus()}
					onDelete={() => void remove()}
				/>
			</div>
		</div>
	);
}

function ScheduleMenu({
	running,
	stopping,
	onRunNow,
	onStop,
	onEdit,
	hasStatus,
	onClearStatus,
	onDelete,
}: {
	running: boolean;
	stopping: boolean;
	onRunNow: () => void;
	onStop?: () => void;
	onEdit: () => void;
	hasStatus: boolean;
	onClearStatus: () => void;
	onDelete: () => void;
}) {
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
		null,
	);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const btnRef = useRef<HTMLButtonElement>(null);

	const close = () => {
		setAnchor(null);
		setConfirmingDelete(false);
	};

	const toggle = () => {
		if (anchor) {
			close();
			return;
		}
		const rect = btnRef.current?.getBoundingClientRect();
		if (!rect) return;
		setAnchor({ top: rect.bottom + 4, left: rect.right });
	};

	useEffect(() => {
		if (!anchor) return;
		const onDocClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};
		const onViewportChange = () => close();
		document.addEventListener("mousedown", onDocClick);
		window.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange);
		};
	}, [anchor]);

	const pick = (fn: () => void) => () => {
		close();
		fn();
	};

	return (
		<div ref={ref} style={{ display: "inline-flex" }}>
			<button
				ref={btnRef}
				type="button"
				onClick={toggle}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				aria-label="Task actions"
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					border: "none",
					background: anchor ? T.surfaceHi : "transparent",
					color: anchor ? T.text : T.textFaint,
					cursor: "pointer",
					borderRadius: 4,
					padding: 0,
				}}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="currentColor"
					aria-hidden
				>
					<circle cx="7" cy="3" r="1.3" />
					<circle cx="7" cy="7" r="1.3" />
					<circle cx="7" cy="11" r="1.3" />
				</svg>
			</button>
			{anchor ? (
				<div
					role="menu"
					style={{
						position: "fixed",
						top: anchor.top,
						left: anchor.left,
						transform: "translateX(-100%)",
						minWidth: 160,
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 1000,
						boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
					}}
				>
					{onStop ? (
						<ScheduleMenuItem
							label={stopping ? "Stopping…" : "Stop"}
							danger
							disabled={stopping}
							onClick={pick(onStop)}
						/>
					) : (
						<ScheduleMenuItem
							label={running ? "Starting…" : "Run now"}
							disabled={running}
							onClick={pick(onRunNow)}
						/>
					)}
					<ScheduleMenuItem label="Edit" onClick={pick(onEdit)} />
					{hasStatus ? (
						<ScheduleMenuItem
							label="Clear status"
							onClick={pick(onClearStatus)}
						/>
					) : null}
					<ScheduleMenuItem
						label={confirmingDelete ? "Confirm delete" : "Delete"}
						danger
						onClick={
							confirmingDelete
								? pick(onDelete)
								: () => setConfirmingDelete(true)
						}
					/>
				</div>
			) : null}
		</div>
	);
}

function ScheduleMenuItem({
	label,
	danger,
	disabled,
	onClick,
}: {
	label: string;
	danger?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				width: "100%",
				textAlign: "left",
				padding: "6px 10px",
				borderRadius: 6,
				border: "none",
				background:
					hover && !disabled
						? danger
							? T.dangerSoft
							: T.surface
						: "transparent",
				color: disabled ? T.textMute : danger ? T.danger : T.text,
				fontSize: 13,
				cursor: disabled ? "default" : "pointer",
			}}
		>
			{label}
		</button>
	);
}
