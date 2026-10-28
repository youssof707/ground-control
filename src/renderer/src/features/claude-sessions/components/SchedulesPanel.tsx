import { useState } from "react";
import type { Schedule } from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { folderName } from "../lib/folderName";
import { formatMessageTime } from "../lib/messageTime";
import { formatNextFire, formatScheduleKind } from "../lib/scheduleFormat";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { Switch } from "../../../design/Switch";
import { promptPreview } from "./ShortcutForm";

export function scheduleLabel(s: Schedule): string {
	return s.title.trim() || promptPreview(s.prompt) || "Untitled schedule";
}

function errorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
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
				No schedules yet.
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
	const [error, setError] = useState<string | null>(null);
	const lastSession = useSessionsStore((s) =>
		schedule.lastSessionId ? s.sessions[schedule.lastSessionId] : undefined,
	);

	const setEnabled = async (enabled: boolean) => {
		setError(null);
		try {
			const updated = await window.claude.setScheduleEnabled(
				schedule.id,
				enabled,
			);
			useSchedulesStore.getState().upsert(updated);
		} catch (err) {
			setError(errorMessage(err));
		}
	};

	const remove = async () => {
		setError(null);
		try {
			await window.claude.removeSchedule(schedule.id);
			useSchedulesStore.getState().remove(schedule.id);
		} catch (err) {
			setError(errorMessage(err));
			throw err;
		}
	};

	const stop = (e: React.SyntheticEvent) => e.stopPropagation();

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onEdit}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onEdit();
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
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: hover ? T.surfaceHi : T.surface,
				color: T.text,
				cursor: "pointer",
				fontSize: 12.5,
				transition: "background 80ms ease, border-color 80ms ease",
				outline: "none",
				opacity: schedule.enabled ? 1 : 0.7,
			}}
		>
			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: "flex",
					flexDirection: "column",
					gap: 3,
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
					{scheduleLabel(schedule)}
				</span>
				<span
					style={{
						fontSize: 11,
						color: T.textDim,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					<span style={{ fontFamily: T.mono }}>{folderName(schedule.cwd)}</span>
					{" · "}
					{formatScheduleKind(schedule.kind, now)}
					{" · "}
					{schedule.enabled
						? formatNextFire(schedule.nextFireAt, now)
						: "Paused"}
				</span>
				{error ?? schedule.lastError ? (
					<span style={{ fontSize: 11, color: T.danger }}>
						{error ?? schedule.lastError}
					</span>
				) : schedule.lastFiredAt ? (
					<span style={{ fontSize: 11, color: T.textMute }}>
						Last run {formatMessageTime(schedule.lastFiredAt)}
						{schedule.lastSkippedAt &&
						schedule.lastSkippedAt > schedule.lastFiredAt
							? ` · skipped ${formatMessageTime(schedule.lastSkippedAt)} (still running)`
							: ""}
						{lastSession ? (
							<>
								{" · "}
								<button
									type="button"
									onClick={(e) => {
										stop(e);
										onOpenSession(lastSession.id);
									}}
									style={{
										border: "none",
										background: "transparent",
										padding: 0,
										color: T.accent,
										cursor: "pointer",
										font: "inherit",
										textDecoration: "underline",
									}}
								>
									Open
								</button>
							</>
						) : null}
					</span>
				) : null}
			</div>
			<div
				onClick={stop}
				onKeyDown={stop}
				style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
			>
				<Switch
					label={schedule.enabled ? "Turn schedule off" : "Turn schedule on"}
					checked={schedule.enabled}
					onChange={(next) => void setEnabled(next)}
				/>
				<ConfirmDeleteButton label="schedule" onDelete={remove} />
			</div>
		</div>
	);
}
