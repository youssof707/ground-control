import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { Schedule, ScheduleStatusColor } from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { Switch } from "../../../design/Switch";
import { useScheduleControls } from "../hooks/useScheduleControls";
import { useSchedulerModalStore } from "../stores/useSchedulerModalStore";
import { formatNextFire, formatScheduleKind } from "../lib/scheduleFormat";
import { formatShortAgo } from "../lib/messageTime";

const NOW_TICK_MS = 30_000;

const STATUS_TINT: Record<ScheduleStatusColor, string> = {
	green: T.ok,
	yellow: T.warn,
	red: T.danger,
};

const ACTION_BTN = {
	height: 26,
	padding: "0 9px",
	gap: 6,
	fontSize: 12,
	borderRadius: 6,
	flexShrink: 0,
} as const;

type MetaPart = { text: string; tone?: string };

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}

function scheduleMeta(
	schedule: Schedule,
	now: number,
	running: boolean,
): MetaPart[] {
	const parts: MetaPart[] = [
		{ text: formatScheduleKind(schedule.kind, now), tone: T.textDim },
	];
	if (running) parts.push({ text: "Running now", tone: T.ok });
	else if (schedule.enabled && schedule.nextFireAt !== undefined) {
		parts.push({ text: `Next ${formatNextFire(schedule.nextFireAt, now)}` });
	}
	if (schedule.lastFiredAt !== undefined && !running) {
		const ago = formatShortAgo(schedule.lastFiredAt, now);
		parts.push({ text: ago === "now" ? "Ran just now" : `Ran ${ago} ago` });
	}
	const skippedRecently =
		schedule.lastSkippedAt !== undefined &&
		schedule.lastSkippedAt > (schedule.lastFiredAt ?? 0);
	if (skippedRecently) {
		parts.push({
			text:
				schedule.lastSkipReason === "usageLimit"
					? "Skipped (usage limit)"
					: "Skipped (still running)",
			tone: T.warn,
		});
	}
	return parts;
}

function LabeledSwitch({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<label
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 7,
				height: 26,
				flexShrink: 0,
				fontSize: 12,
				color: T.textDim,
				cursor: "pointer",
				userSelect: "none",
			}}
		>
			{label}
			<Switch label={label} checked={checked} onChange={onChange} />
		</label>
	);
}

function Divider() {
	return (
		<span
			aria-hidden
			style={{
				width: 1,
				height: 16,
				background: T.borderSoft,
				flexShrink: 0,
			}}
		/>
	);
}

function ActionButton({
	icon,
	label,
	onClick,
	disabled,
	tone,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	tone?: string;
}) {
	return (
		<button
			type="button"
			className="btn btn-ghost"
			disabled={disabled}
			onClick={onClick}
			style={{ ...ACTION_BTN, ...(tone ? { color: tone } : {}) }}
		>
			{icon}
			{label}
		</button>
	);
}

export function ScheduleHeaderStrip({ schedule }: { schedule: Schedule }) {
	const now = useNow(NOW_TICK_MS);
	const {
		error,
		running,
		stopping,
		canStop,
		setEnabled,
		setAlwaysShowStatus,
		runNow,
		stopRun,
	} = useScheduleControls(schedule);
	const shownError = error ?? schedule.lastError;
	const iconTint = running
		? T.ok
		: schedule.status
			? STATUS_TINT[schedule.status.color]
			: T.textMute;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 12,
				rowGap: 4,
				minWidth: 0,
				minHeight: 36,
				padding: "4px 4px 4px 12px",
				background: T.surfaceLow,
				border: `0.5px solid ${T.borderSoft}`,
				borderRadius: 8,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flex: "1 1 240px",
					minWidth: 0,
					fontSize: 12,
					whiteSpace: "nowrap",
				}}
			>
				<span style={{ display: "inline-flex", color: iconTint, flexShrink: 0 }}>
					<ClockIcon />
				</span>
				<span
					style={{
						overflow: "hidden",
						textOverflow: "ellipsis",
						minWidth: 0,
						color: T.textMute,
					}}
				>
					{shownError ? (
						<span style={{ color: T.danger }}>{shownError}</span>
					) : (
						scheduleMeta(schedule, now, running).map((part, i) => (
							<Fragment key={part.text}>
								{i > 0 ? (
									<span style={{ color: T.textFaint, margin: "0 6px" }}>·</span>
								) : null}
								<span style={{ color: part.tone ?? T.textMute }}>
									{part.text}
								</span>
							</Fragment>
						))
					)}
				</span>
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 14,
					flexShrink: 0,
					paddingRight: 4,
				}}
			>
				<LabeledSwitch
					label="Always show"
					checked={schedule.alwaysShowStatus === true}
					onChange={(next) => void setAlwaysShowStatus(next)}
				/>
				<LabeledSwitch
					label="On"
					checked={schedule.enabled}
					onChange={(next) => void setEnabled(next)}
				/>
			</div>
			<Divider />
			<div style={{ display: "flex", alignItems: "center", gap: 2 }}>
				{canStop ? (
					<ActionButton
						icon={<StopIcon />}
						label={stopping ? "Stopping…" : "Stop"}
						disabled={stopping}
						onClick={() => void stopRun()}
						tone={T.danger}
					/>
				) : (
					<ActionButton
						icon={<PlayIcon />}
						label={running ? "Starting…" : "Run now"}
						disabled={running}
						onClick={() => void runNow()}
					/>
				)}
				<ActionButton
					icon={<PencilIcon />}
					label="Edit"
					onClick={() =>
						useSchedulerModalStore.getState().openEdit(schedule.id)
					}
				/>
			</div>
		</div>
	);
}

function ClockIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
			<circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.3" />
			<path
				d="M7 4v3.2l2.1 1.3"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function PlayIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
			<path d="M2.5 1.6v6.8L8.4 5 2.5 1.6z" fill="currentColor" />
		</svg>
	);
}

function StopIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
			<rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
		</svg>
	);
}

function PencilIcon() {
	return (
		<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
			<path
				d="M8.2 1.8a1.1 1.1 0 011.6 1.6L4.3 8.9 2 9.5l.6-2.3 5.6-5.4z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
