import { useState } from "react";
import type { SessionMode } from "@shared/claude-sessions/types";
import {
	DEFAULT_SCHEDULE_KEEP_LAST,
	MAX_SCHEDULE_KEEP_LAST,
	type CreateScheduleInput,
	type Schedule,
	type ScheduleKind,
} from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { ModeToggle } from "../../../design/Atoms";
import { LabeledInput } from "../../../design/FormControls";
import { Segmented } from "./BabysitRules";
import { useSettingsStore } from "../stores/useSettingsStore";
import { folderName } from "../lib/folderName";
import {
	HOUR_MS,
	MINUTE_MS,
	fromDatetimeLocalValue,
	fromTimeValue,
	toDatetimeLocalValue,
	toTimeValue,
} from "../lib/scheduleFormat";

const DEFAULT_DAILY_TIME = "09:00";

export interface ScheduleDraft {
	title: string;
	prompt: string;
	cwd: string;
	mode: SessionMode;
	kind: ScheduleKind["type"];
	onceAt: string;
	everyAmount: string;
	everyUnit: "minutes" | "hours";
	dailyTime: string;
	keepLast: string;
}

export function draftFromSchedule(s?: Schedule): ScheduleDraft {
	if (!s) {
		return {
			title: "",
			prompt: "",
			cwd: useSettingsStore.getState().lastUsedWorkspace ?? "",
			mode: "acceptEdits",
			kind: "repeat",
			onceAt: toDatetimeLocalValue(Date.now() + HOUR_MS),
			everyAmount: "30",
			everyUnit: "minutes",
			dailyTime: DEFAULT_DAILY_TIME,
			keepLast: String(DEFAULT_SCHEDULE_KEEP_LAST),
		};
	}
	const kind = s.kind;
	const wholeHours = kind.type === "repeat" && kind.everyMs % HOUR_MS === 0;
	return {
		title: s.title,
		prompt: s.prompt,
		cwd: s.cwd,
		mode: s.mode,
		kind: kind.type,
		onceAt: toDatetimeLocalValue(
			kind.type === "once" ? kind.at : Date.now() + HOUR_MS,
		),
		everyAmount:
			kind.type === "repeat"
				? String(
					wholeHours
						? kind.everyMs / HOUR_MS
						: Math.round(kind.everyMs / MINUTE_MS),
				)
				: "30",
		everyUnit: wholeHours ? "hours" : "minutes",
		dailyTime:
			kind.type === "daily" ? toTimeValue(kind.minuteOfDay) : DEFAULT_DAILY_TIME,
		keepLast: String(s.keepLast),
	};
}

export type ScheduleValidation =
	| { ok: true; input: CreateScheduleInput }
	| { ok: false; error: string };

export function validateDraft(
	d: ScheduleDraft,
	now = Date.now(),
): ScheduleValidation {
	const prompt = d.prompt.trim();
	if (!prompt) return { ok: false, error: "Prompt is required" };
	if (!d.cwd) return { ok: false, error: "Choose a folder" };
	const keepLast = Number(d.keepLast);
	if (
		!Number.isInteger(keepLast) ||
		keepLast < 1 ||
		keepLast > MAX_SCHEDULE_KEEP_LAST
	) {
		return {
			ok: false,
			error: `Keep last must be between 1 and ${MAX_SCHEDULE_KEEP_LAST}`,
		};
	}
	let kind: ScheduleKind;
	if (d.kind === "once") {
		const at = fromDatetimeLocalValue(d.onceAt);
		if (at === null) return { ok: false, error: "Pick a date and time" };
		if (at <= now) return { ok: false, error: "Pick a time in the future" };
		kind = { type: "once", at };
	} else if (d.kind === "daily") {
		const minuteOfDay = fromTimeValue(d.dailyTime);
		if (minuteOfDay === null) return { ok: false, error: "Pick a time of day" };
		kind = { type: "daily", minuteOfDay };
	} else {
		const amount = Number(d.everyAmount);
		if (!Number.isInteger(amount) || amount < 1) {
			return { ok: false, error: "Interval must be a whole number of at least 1" };
		}
		kind = {
			type: "repeat",
			everyMs: amount * (d.everyUnit === "hours" ? HOUR_MS : MINUTE_MS),
		};
	}
	const title = d.title.trim();
	return {
		ok: true,
		input: {
			title: title || undefined,
			prompt,
			cwd: d.cwd,
			mode: d.mode,
			kind,
			keepLast,
		},
	};
}

const fieldLabelStyle: React.CSSProperties = {
	fontSize: 11,
	color: T.textDim,
	letterSpacing: 0.2,
};

const inputStyle: React.CSSProperties = {
	appearance: "none",
	background: T.surfaceLow,
	color: T.text,
	border: `0.5px solid ${T.border}`,
	borderRadius: 7,
	boxSizing: "border-box",
	height: 29,
	padding: "0 9px",
	fontSize: 12.5,
	fontFamily: T.sans,
	outline: "none",
	colorScheme: "dark",
	transition: "border-color 80ms ease",
};

const KIND_OPTIONS = [
	{ value: "once", label: "Once", tone: T.text },
	{ value: "repeat", label: "Every", tone: T.text },
	{ value: "daily", label: "Daily", tone: T.text },
] as const satisfies readonly {
	value: ScheduleDraft["kind"];
	label: string;
	tone: string;
}[];

const UNIT_OPTIONS = [
	{ value: "minutes", label: "Minutes", tone: T.text },
	{ value: "hours", label: "Hours", tone: T.text },
] as const satisfies readonly {
	value: ScheduleDraft["everyUnit"];
	label: string;
	tone: string;
}[];

function focusBorder(e: React.FocusEvent<HTMLElement>) {
	e.currentTarget.style.borderColor = T.accentBorder;
}

function blurBorder(e: React.FocusEvent<HTMLElement>) {
	e.currentTarget.style.borderColor = T.border;
}

function blockNativePicker(e: React.KeyboardEvent<HTMLInputElement>) {
	if (e.key === " " || e.key === "F4" || (e.altKey && e.key === "ArrowDown")) {
		e.preventDefault();
	}
}

export function ScheduleFormFields({
	value,
	onChange,
	disabled,
}: {
	value: ScheduleDraft;
	onChange: (next: ScheduleDraft) => void;
	disabled?: boolean;
}) {
	const pickFolder = async () => {
		const picked = await window.claude.pickFolder({
			defaultPath: value.cwd || undefined,
		});
		if (picked) onChange({ ...value, cwd: picked });
	};
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<LabeledInput
				label="Name (optional)"
				value={value.title}
				onChange={(title) => onChange({ ...value, title })}
				placeholder="Falls back to the first line of the prompt"
				autoFocus
				disabled={disabled}
				maxLength={200}
				mono={false}
			/>

			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Prompt</span>
				<textarea
					value={value.prompt}
					onChange={(e) => onChange({ ...value, prompt: e.target.value })}
					placeholder="Sent as the first message of each run"
					disabled={disabled}
					rows={5}
					style={{
						...inputStyle,
						height: "auto",
						padding: "7px 9px",
						fontSize: 13,
						lineHeight: 1.45,
						resize: "vertical",
						minHeight: 88,
					}}
					onFocus={focusBorder}
					onBlur={blurBorder}
				/>
			</label>

			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Folder</span>
				<FolderButton
					label={value.cwd ? folderName(value.cwd) : "Choose folder…"}
					chosen={value.cwd.length > 0}
					disabled={disabled}
					onClick={() => void pickFolder()}
				/>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Mode</span>
				<div>
					<ModeToggle
						mode={value.mode}
						onChange={(mode) => onChange({ ...value, mode })}
						disabled={disabled}
					/>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<span style={fieldLabelStyle}>When</span>
				<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
					<Segmented<ScheduleDraft["kind"]>
						label="Schedule type"
						value={value.kind}
						options={KIND_OPTIONS}
						onChange={(kind) => onChange({ ...value, kind })}
						disabled={disabled}
					/>
					{value.kind === "once" ? (
						<input
							type="datetime-local"
							aria-label="Run at"
							value={value.onceAt}
							min={toDatetimeLocalValue(Date.now())}
							step={60}
							disabled={disabled}
							onChange={(e) => onChange({ ...value, onceAt: e.target.value })}
							onKeyDown={blockNativePicker}
							style={inputStyle}
							onFocus={focusBorder}
							onBlur={blurBorder}
						/>
					) : value.kind === "daily" ? (
						<>
							<span style={{ fontSize: 12.5, color: T.textDim }}>at</span>
							<input
								type="time"
								aria-label="Time of day"
								value={value.dailyTime}
								step={60}
								disabled={disabled}
								onChange={(e) => onChange({ ...value, dailyTime: e.target.value })}
								onKeyDown={blockNativePicker}
								style={inputStyle}
								onFocus={focusBorder}
								onBlur={blurBorder}
							/>
						</>
					) : (
						<>
							<span style={{ fontSize: 12.5, color: T.textDim }}>every</span>
							<input
								type="number"
								aria-label="Interval"
								min={1}
								step={1}
								value={value.everyAmount}
								disabled={disabled}
								onChange={(e) =>
									onChange({ ...value, everyAmount: e.target.value })
								}
								style={{ ...inputStyle, width: 64, fontFamily: T.mono }}
								onFocus={focusBorder}
								onBlur={blurBorder}
							/>
							<Segmented<ScheduleDraft["everyUnit"]>
								label="Interval unit"
								value={value.everyUnit}
								options={UNIT_OPTIONS}
								onChange={(everyUnit) => onChange({ ...value, everyUnit })}
								disabled={disabled}
							/>
						</>
					)}
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Keep last runs</span>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<input
						type="number"
						aria-label="Keep last runs"
						min={1}
						max={MAX_SCHEDULE_KEEP_LAST}
						step={1}
						value={value.keepLast}
						disabled={disabled}
						onChange={(e) => onChange({ ...value, keepLast: e.target.value })}
						style={{ ...inputStyle, width: 64, fontFamily: T.mono }}
						onFocus={focusBorder}
						onBlur={blurBorder}
					/>
					<span style={{ fontSize: 11, color: T.textFaint }}>
						Older finished runs from this schedule are deleted automatically.
					</span>
				</div>
			</div>
		</div>
	);
}

function FolderButton({
	label,
	chosen,
	disabled,
	onClick,
}: {
	label: string;
	chosen: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				alignSelf: "flex-start",
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				maxWidth: "100%",
				padding: "5px 8px 5px 10px",
				borderRadius: 7,
				border: `0.5px solid ${hover ? T.textFaint : T.border}`,
				background: hover ? T.surface : T.bg,
				fontFamily: T.mono,
				fontSize: 12,
				color: chosen ? T.text : T.textDim,
				cursor: disabled ? "default" : "pointer",
				transition: "background 120ms ease, border-color 120ms ease",
			}}
		>
			<span
				style={{
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{label}
			</span>
		</button>
	);
}
