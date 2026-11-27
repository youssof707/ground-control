import { useState } from "react";
import {
	type CreateScheduleInput,
	type Schedule,
	type ScheduleKind,
} from "@shared/schemas/schedules";
import { T } from "../../../design/tokens";
import { LabeledInput } from "../../../design/FormControls";
import { Switch } from "../../../design/Switch";
import {
	BabysitRuleCards,
	Segmented,
	configFromDraft,
	draftFromConfig,
	type BabysitCardKey,
	type BabysitDraft,
} from "./BabysitRules";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ModelPickerButton, modelButtonLabel } from "./SettingsModal";
import { folderName } from "../lib/folderName";
import {
	HOUR_MS,
	MINUTE_MS,
	WEEKDAYS_MONDAY_FIRST,
	fromDatetimeLocalValue,
	fromTimeValue,
	toDatetimeLocalValue,
	toTimeValue,
} from "../lib/scheduleFormat";

const DEFAULT_TIME_OF_DAY = "09:00";
const DEFAULT_WEEKLY_DAYS: readonly number[] = [1, 3, 5];
const SCHEDULE_OMITTED_RULES: readonly BabysitCardKey[] = ["plan", "keepAwake"];

export interface ScheduleDraft {
	title: string;
	prompt: string;
	cwd: string;
	kind: ScheduleKind["type"];
	onceAt: string;
	everyAmount: string;
	everyUnit: "minutes" | "hours";
	timeOfDay: string;
	weeklyDays: readonly number[];
	babysit: BabysitDraft;
	model: string | undefined;
	alwaysShowStatus: boolean;
	chimeOnYellow: boolean;
	chimeOnRed: boolean;
}

export function draftFromSchedule(s?: Schedule): ScheduleDraft {
	const defaultBabysit = useSettingsStore.getState().defaultBabysit;
	if (!s) {
		return {
			title: "",
			prompt: "",
			cwd: useSettingsStore.getState().lastUsedWorkspace ?? "",
			kind: "repeat",
			onceAt: toDatetimeLocalValue(Date.now() + HOUR_MS),
			everyAmount: "30",
			everyUnit: "minutes",
			timeOfDay: DEFAULT_TIME_OF_DAY,
			weeklyDays: DEFAULT_WEEKLY_DAYS,
			babysit: draftFromConfig(defaultBabysit),
			model: useSettingsStore.getState().defaultModel,
			alwaysShowStatus: false,
			chimeOnYellow: false,
			chimeOnRed: false,
		};
	}
	const kind = s.kind;
	const wholeHours = kind.type === "repeat" && kind.everyMs % HOUR_MS === 0;
	return {
		title: s.title,
		prompt: s.prompt,
		cwd: s.cwd,
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
		timeOfDay:
			kind.type === "daily" || kind.type === "weekly"
				? toTimeValue(kind.minuteOfDay)
				: DEFAULT_TIME_OF_DAY,
		weeklyDays: kind.type === "weekly" ? kind.days : DEFAULT_WEEKLY_DAYS,
		babysit: draftFromConfig(s.babysit ?? defaultBabysit),
		model: s.model,
		alwaysShowStatus: s.alwaysShowStatus ?? false,
		chimeOnYellow: s.chimeOnYellow ?? false,
		chimeOnRed: s.chimeOnRed ?? false,
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
	let kind: ScheduleKind;
	if (d.kind === "once") {
		const at = fromDatetimeLocalValue(d.onceAt);
		if (at === null) return { ok: false, error: "Pick a date and time" };
		if (at <= now) return { ok: false, error: "Pick a time in the future" };
		kind = { type: "once", at };
	} else if (d.kind === "daily") {
		const minuteOfDay = fromTimeValue(d.timeOfDay);
		if (minuteOfDay === null) return { ok: false, error: "Pick a time of day" };
		kind = { type: "daily", minuteOfDay };
	} else if (d.kind === "weekly") {
		if (d.weeklyDays.length === 0) {
			return { ok: false, error: "Pick at least one day" };
		}
		const minuteOfDay = fromTimeValue(d.timeOfDay);
		if (minuteOfDay === null) return { ok: false, error: "Pick a time of day" };
		kind = {
			type: "weekly",
			days: [...d.weeklyDays].sort((a, b) => a - b),
			minuteOfDay,
		};
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
			kind,
			babysit: configFromDraft(d.babysit),
			model: d.model,
			alwaysShowStatus: d.alwaysShowStatus,
			chimeOnYellow: d.chimeOnYellow,
			chimeOnRed: d.chimeOnRed,
		},
	};
}

const chimeOptionStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 6,
	fontSize: 12.5,
	color: T.textDim,
};

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
	{ value: "weekly", label: "Weekly", tone: T.text },
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
	onPickModel,
	disabled,
}: {
	value: ScheduleDraft;
	onChange: (next: ScheduleDraft) => void;
	onPickModel: () => void;
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
				<span style={fieldLabelStyle}>Model</span>
				<ModelPickerButton
					label={modelButtonLabel(value.model)}
					onClick={onPickModel}
				/>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<span style={fieldLabelStyle}>When</span>
				<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
					<Segmented<ScheduleDraft["kind"]>
						label="Repeat"
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
					) : value.kind === "daily" || value.kind === "weekly" ? (
						<>
							{value.kind === "weekly" && (
								<WeekdayPicker
									days={value.weeklyDays}
									onChange={(weeklyDays) => onChange({ ...value, weeklyDays })}
									disabled={disabled}
								/>
							)}
							<span style={{ fontSize: 12.5, color: T.textDim }}>at</span>
							<input
								type="time"
								aria-label="Time of day"
								value={value.timeOfDay}
								step={60}
								disabled={disabled}
								onChange={(e) => onChange({ ...value, timeOfDay: e.target.value })}
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
				<span style={fieldLabelStyle}>Always show status</span>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<Switch
						checked={value.alwaysShowStatus}
						onChange={(alwaysShowStatus) =>
							onChange({ ...value, alwaysShowStatus })
						}
						label="Always show status"
						disabled={disabled}
					/>
					<span style={{ fontSize: 11, color: T.textFaint }}>
						When off, the sidebar only shows this task while it's unread
						or open.
					</span>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span style={fieldLabelStyle}>Chime</span>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<span style={chimeOptionStyle}>
						<Switch
							checked={value.chimeOnYellow}
							onChange={(chimeOnYellow) =>
								onChange({ ...value, chimeOnYellow })
							}
							label="Chime on yellow"
							disabled={disabled}
						/>
						On yellow
					</span>
					<span style={chimeOptionStyle}>
						<Switch
							checked={value.chimeOnRed}
							onChange={(chimeOnRed) => onChange({ ...value, chimeOnRed })}
							label="Chime on red"
							disabled={disabled}
						/>
						On red
					</span>
					<span style={{ fontSize: 11, color: T.textFaint }}>
						Plays a sound when the status turns this color.
					</span>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<span style={fieldLabelStyle}>Babysitter</span>
				<BabysitRuleCards
					draft={value.babysit}
					onChange={(update) =>
						onChange({ ...value, babysit: update(value.babysit) })
					}
					disabled={disabled}
					omit={SCHEDULE_OMITTED_RULES}
				/>
			</div>
		</div>
	);
}

function WeekdayPicker({
	days,
	onChange,
	disabled,
}: {
	days: readonly number[];
	onChange: (days: readonly number[]) => void;
	disabled?: boolean;
}) {
	const toggle = (day: number) =>
		onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
	return (
		<div
			role="group"
			aria-label="Days of the week"
			style={{
				display: "inline-flex",
				flexShrink: 0,
				background: T.bg,
				border: `0.5px solid ${T.border}`,
				borderRadius: 7,
				padding: 2,
				gap: 2,
			}}
		>
			{WEEKDAYS_MONDAY_FIRST.map((w) => (
				<WeekdayToggle
					key={w.day}
					label={w.short}
					active={days.includes(w.day)}
					onClick={() => toggle(w.day)}
					disabled={disabled}
				/>
			))}
		</div>
	);
}

function WeekdayToggle({
	label,
	active,
	onClick,
	disabled,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	disabled?: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			disabled={disabled}
			style={{
				appearance: "none",
				border: "none",
				background: active ? T.surfaceHi : hover ? T.surface : "transparent",
				color: active ? T.text : T.textDim,
				fontSize: 11.5,
				fontFamily: "inherit",
				fontWeight: active ? 600 : 500,
				padding: "5px 8px",
				borderRadius: 5,
				whiteSpace: "nowrap",
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
				transition: "background 80ms ease, color 80ms ease",
			}}
		>
			{label}
		</button>
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
