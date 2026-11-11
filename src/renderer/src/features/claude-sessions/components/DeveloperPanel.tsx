import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ACTIVITY_SOURCES,
	type ActivityEntry,
	type CaffeinateProcess,
	type ActivitySource,
} from "@shared/activityLog";
import { T } from "../../../design/tokens";
import { Section } from "./SettingsSection";

const MAX_ENTRIES = 2000;
const CLEAR_CONFIRM_MS = 3000;
const DAY_MS = 86_400_000;
const LOG_HEIGHT = "clamp(160px, calc(min(640px, 91vh - 24px) - 330px), 360px)";

const SOURCE_TONES: Record<ActivitySource, string> = {
	pmset: T.info,
	caffeinate: T.warn,
	babysitter: T.babysit,
	"auto-resume": T.ok,
	schedule: T.accent,
	power: T.textDim,
	"delete-hook": T.danger,
};

const SOURCE_LABELS: Record<ActivitySource, string> = {
	pmset: "pmset",
	caffeinate: "caffeinate",
	babysitter: "babysitter",
	"auto-resume": "resume",
	schedule: "schedule",
	power: "power",
	"delete-hook": "delete hook",
};

type SourceFilter = ActivitySource | "all";

interface PmsetEvent {
	type: string;
	at: number;
	owner: string;
}

const PMSET_EVENT_RE =
	/^\s*\[\d+\]\s+(\S+)\s+at\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\s+by\s+'([^']*)')?/;

function pad(n: number, width = 2): string {
	return String(n).padStart(width, "0");
}

function startOfDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function dayLabel(ms: number): string {
	const today = startOfDay(Date.now());
	const day = startOfDay(ms);
	if (day === today) return "Today";
	if (day === today - DAY_MS) return "Yesterday";
	if (day === today + DAY_MS) return "Tomorrow";
	return new Date(ms).toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function clockTime(ms: number, withMs: boolean): string {
	const d = new Date(ms);
	const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}

function parsePmsetSchedule(output: string): PmsetEvent[] {
	const events: PmsetEvent[] = [];
	for (const line of output.split("\n")) {
		const m = PMSET_EVENT_RE.exec(line);
		if (!m) continue;
		const [, type, month, day, year, h, min, s, owner] = m;
		events.push({
			type,
			at: new Date(+year, +month - 1, +day, +h, +min, +s).getTime(),
			owner: owner ?? "",
		});
	}
	return events.sort((a, b) => a.at - b.at);
}

function fileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function tint(tone: string, percent: number): string {
	return `color-mix(in oklab, ${tone} ${percent}%, transparent)`;
}

export function DeveloperPanel() {
	return (
		<div>
			<ActivityLogSection />
			<CaffeinateSection />
			<PmsetScheduleSection />
		</div>
	);
}

function Card({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				background: T.bg,
				overflow: "hidden",
			}}
		>
			{children}
		</div>
	);
}

function ScrollList({
	maxHeight,
	height,
	children,
	...aria
}: {
	maxHeight?: number;
	height?: string;
	children: React.ReactNode;
	role?: string;
	"aria-label"?: string;
}) {
	return (
		<div
			{...aria}
			style={{
				height,
				maxHeight,
				overflowY: "auto",
				scrollbarWidth: "thin",
				scrollbarColor: `${T.border} ${T.surfaceLow}`,
			}}
		>
			{children}
		</div>
	);
}

function useActivityLog() {
	const [path, setPath] = useState<string | null>(null);
	const [entries, setEntries] = useState<ActivityEntry[]>([]);

	useEffect(() => {
		let cancelled = false;
		let loaded = false;
		const buffered: ActivityEntry[] = [];
		const off = window.claude.on("activityLog:appended", (payload) => {
			const entry = payload as ActivityEntry;
			if (!loaded) buffered.push(entry);
			else setEntries((prev) => [...prev, entry].slice(-MAX_ENTRIES));
		});
		void window.claude.readActivityLog().then((snapshot) => {
			if (cancelled) return;
			loaded = true;
			setPath(snapshot.path);
			const lastAt = snapshot.entries.at(-1)?.at ?? 0;
			const fresh = buffered.filter((e) => e.at > lastAt);
			setEntries([...snapshot.entries, ...fresh].slice(-MAX_ENTRIES));
		});
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const clear = useCallback(() => {
		void window.claude.clearActivityLog().then(() => setEntries([]));
	}, []);

	return { path, entries, clear };
}

function ActivityLogSection() {
	const { path, entries, clear } = useActivityLog();
	const [filter, setFilter] = useState<SourceFilter>("all");
	const [confirmingClear, setConfirmingClear] = useState(false);
	const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (confirmTimer.current) clearTimeout(confirmTimer.current);
		},
		[],
	);

	const onClear = () => {
		if (confirmTimer.current) clearTimeout(confirmTimer.current);
		if (confirmingClear) {
			setConfirmingClear(false);
			clear();
			return;
		}
		setConfirmingClear(true);
		confirmTimer.current = setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_MS);
	};

	const visible = useMemo(() => {
		const list = filter === "all" ? entries : entries.filter((e) => e.source === filter);
		return [...list].reverse();
	}, [entries, filter]);

	const counts = useMemo(() => {
		const bySource = new Map<SourceFilter, number>([["all", entries.length]]);
		for (const e of entries) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
		return bySource;
	}, [entries]);

	return (
		<Section
			title="Activity log"
			actions={
				<>
					<SmallButton onClick={() => void window.claude.revealActivityLog()}>
						Show in Finder
					</SmallButton>
					<SmallButton
						onClick={onClear}
						disabled={entries.length === 0 && !confirmingClear}
						tone={confirmingClear ? T.danger : undefined}
					>
						{confirmingClear ? "Confirm clear" : "Clear"}
					</SmallButton>
				</>
			}
		>
			<SourceFilterBar value={filter} counts={counts} onChange={setFilter} />
			<Card>
				<ScrollList role="log" aria-label="Activity log entries" height={LOG_HEIGHT}>
					{visible.length === 0 ? (
						<EmptyState
							text={
								filter === "all"
									? "Nothing logged yet"
									: `No ${SOURCE_LABELS[filter]} events yet`
							}
						/>
					) : (
						<LogRows entries={visible} />
					)}
				</ScrollList>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 12,
						height: 26,
						padding: "0 12px",
						borderTop: `0.5px solid ${T.borderSoft}`,
						background: T.surfaceLow,
						fontSize: 11,
						color: T.textMute,
					}}
				>
					<span
						style={{
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							fontFamily: T.mono,
							fontSize: 10.5,
						}}
					>
						{path ? fileName(path) : ""}
					</span>
					<span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
						{visible.length.toLocaleString()} {visible.length === 1 ? "event" : "events"}
					</span>
				</div>
			</Card>
		</Section>
	);
}

function LogRows({ entries }: { entries: ActivityEntry[] }) {
	return (
		<>
			{entries.map((e, i) => {
				const firstOfDay = i === 0 || startOfDay(entries[i - 1].at) !== startOfDay(e.at);
				return (
					<Fragment key={`${e.at}:${i}`}>
						{firstOfDay ? <DayDivider label={dayLabel(e.at)} first={i === 0} /> : null}
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "82px 14px minmax(0, 1fr)",
								alignItems: "start",
								columnGap: 8,
								padding: "7px 12px",
								borderTop: firstOfDay ? "none" : `0.5px solid ${T.borderSoft}`,
							}}
						>
							<span
								style={{
									fontFamily: T.mono,
									fontSize: 10.5,
									lineHeight: "18px",
									color: T.textMute,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{clockTime(e.at, true)}
							</span>
							<SourceDot source={e.source} />
							<div style={{ minWidth: 0 }}>
								<SourceLabel source={e.source} />
								<div
									style={{
										marginTop: 1,
										fontSize: 12,
										lineHeight: 1.5,
										color: T.text,
										overflowWrap: "anywhere",
									}}
								>
									{e.message}
								</div>
							</div>
						</div>
					</Fragment>
				);
			})}
		</>
	);
}

function DayDivider({ label, first }: { label: string; first: boolean }) {
	return (
		<div
			style={{
				position: "sticky",
				top: 0,
				zIndex: 1,
				height: 24,
				display: "flex",
				alignItems: "center",
				padding: "0 12px",
				background: T.surfaceLow,
				borderTop: first ? "none" : `0.5px solid ${T.borderSoft}`,
				borderBottom: `0.5px solid ${T.borderSoft}`,
				fontSize: 10,
				fontWeight: 600,
				letterSpacing: 0.6,
				textTransform: "uppercase",
				color: T.textMute,
			}}
		>
			{label}
		</div>
	);
}

function SourceDot({ source }: { source: ActivitySource }) {
	return (
		<span
			aria-hidden
			style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 18 }}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: SOURCE_TONES[source],
					boxShadow: `0 0 0 3px ${tint(SOURCE_TONES[source], 16)}`,
				}}
			/>
		</span>
	);
}

function SourceLabel({ source }: { source: ActivitySource }) {
	return (
		<span
			style={{
				display: "block",
				fontSize: 11,
				fontWeight: 600,
				lineHeight: "18px",
				color: SOURCE_TONES[source],
			}}
		>
			{SOURCE_LABELS[source]}
		</span>
	);
}

function SourceFilterBar({
	value,
	counts,
	onChange,
}: {
	value: SourceFilter;
	counts: Map<SourceFilter, number>;
	onChange: (value: SourceFilter) => void;
}) {
	const options: { value: SourceFilter; label: string; tone: string }[] = [
		{ value: "all", label: "All", tone: T.accent },
		...ACTIVITY_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s], tone: SOURCE_TONES[s] })),
	];
	return (
		<div
			role="radiogroup"
			aria-label="Filter by source"
			style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}
		>
			{options.map((o) => (
				<FilterChip
					key={o.value}
					label={o.label}
					tone={o.tone}
					count={counts.get(o.value) ?? 0}
					dot={o.value !== "all"}
					active={o.value === value}
					onClick={() => onChange(o.value)}
				/>
			))}
		</div>
	);
}

function FilterChip({
	label,
	tone,
	count,
	dot,
	active,
	onClick,
}: {
	label: string;
	tone: string;
	count: number;
	dot: boolean;
	active: boolean;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			role="radio"
			aria-checked={active}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 24,
				padding: "0 9px",
				border: `0.5px solid ${active ? tint(tone, 45) : T.border}`,
				borderRadius: 999,
				background: active ? tint(tone, 14) : hover ? T.surface : "transparent",
				fontFamily: T.sans,
				fontSize: 11.5,
				fontWeight: 500,
				color: active ? tone : hover ? T.text : T.textDim,
				cursor: "pointer",
				whiteSpace: "nowrap",
				transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
			}}
		>
			{dot ? (
				<span
					aria-hidden
					style={{ width: 6, height: 6, borderRadius: "50%", background: tone, flexShrink: 0 }}
				/>
			) : null}
			{label}
			<span
				style={{
					fontSize: 10.5,
					fontVariantNumeric: "tabular-nums",
					color: active ? tone : T.textFaint,
					opacity: active ? 0.75 : 1,
				}}
			>
				{count.toLocaleString()}
			</span>
		</button>
	);
}

function CaffeinateSection() {
	const [processes, setProcesses] = useState<CaffeinateProcess[] | undefined>(undefined);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(() => {
		setLoading(true);
		void window.claude
			.listCaffeinate()
			.then(setProcesses)
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		refresh();
		return window.claude.on("activityLog:appended", (payload) => {
			if ((payload as ActivityEntry).source === "caffeinate") refresh();
		});
	}, [refresh]);

	return (
		<Section
			title="Active caffeinate"
			actions={
				<SmallButton onClick={refresh} disabled={loading}>
					Refresh
				</SmallButton>
			}
		>
			<Card>
				<ScrollList maxHeight={150}>
					{processes === undefined ? (
						<EmptyState text="Loading…" compact />
					) : processes.length === 0 ? (
						<EmptyState text="Nothing is keeping the Mac awake" compact />
					) : (
						processes.map((p, i) => <CaffeinateRow key={p.pid} process={p} first={i === 0} />)
					)}
				</ScrollList>
			</Card>
		</Section>
	);
}

function CaffeinateRow({ process, first }: { process: CaffeinateProcess; first: boolean }) {
	const detail = process.ours
		? process.sessions.length > 0
			? process.sessions.join(", ")
			: process.args
		: process.args;
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "84px 64px minmax(0, 1fr) auto",
				alignItems: "baseline",
				gap: 10,
				padding: "8px 12px",
				borderTop: first ? "none" : `0.5px solid ${T.borderSoft}`,
			}}
		>
			<span style={{ fontSize: 12, color: T.textDim }}>
				{process.startedAt === null ? "—" : dayLabel(process.startedAt)}
			</span>
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 11,
					color: T.text,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{process.startedAt === null ? "" : clockTime(process.startedAt, false)}
			</span>
			<span
				style={{
					display: "flex",
					alignItems: "baseline",
					gap: 8,
					minWidth: 0,
				}}
			>
				<span
					style={{
						flexShrink: 0,
						fontSize: 11,
						color: process.ours ? T.warn : T.textDim,
					}}
				>
					{process.ours ? "Ground Control" : "Other app"}
				</span>
				<span
					style={{
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						fontFamily: process.ours && process.sessions.length > 0 ? T.sans : T.mono,
						fontSize: process.ours && process.sessions.length > 0 ? 11.5 : 10.5,
						color: T.textFaint,
					}}
				>
					{detail}
				</span>
			</span>
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 10.5,
					color: T.textFaint,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				pid {process.pid}
			</span>
		</div>
	);
}

function PmsetScheduleSection() {
	const [output, setOutput] = useState<string | null | undefined>(undefined);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(() => {
		setLoading(true);
		void window.claude
			.readPmsetSchedule()
			.then(setOutput)
			.finally(() => setLoading(false));
	}, []);

	useEffect(refresh, [refresh]);

	const events = useMemo(() => (output ? parsePmsetSchedule(output) : []), [output]);

	return (
		<Section
			title="Scheduled wakes"
			actions={
				<SmallButton onClick={refresh} disabled={loading}>
					Refresh
				</SmallButton>
			}
		>
			<Card>
				<ScrollList maxHeight={150}>
					{output === undefined ? (
						<EmptyState text="Loading…" compact />
					) : output === null ? (
						<EmptyState
							text="pmset access not granted yet. It's requested the first time auto-resume or a schedule needs a wake."
							compact
						/>
					) : events.length === 0 ? (
						<EmptyState text="No wakes scheduled" compact />
					) : (
						events.map((ev, i) => <PmsetRow key={`${ev.at}:${i}`} event={ev} first={i === 0} />)
					)}
				</ScrollList>
			</Card>
		</Section>
	);
}

function PmsetRow({ event, first }: { event: PmsetEvent; first: boolean }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "84px 64px 48px minmax(0, 1fr)",
				alignItems: "baseline",
				gap: 10,
				padding: "8px 12px",
				borderTop: first ? "none" : `0.5px solid ${T.borderSoft}`,
			}}
		>
			<span style={{ fontSize: 12, color: T.textDim }}>{dayLabel(event.at)}</span>
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 11,
					color: T.text,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{clockTime(event.at, false)}
			</span>
			<span style={{ fontSize: 11, color: T.info }}>{event.type}</span>
			<span
				style={{
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					fontFamily: T.mono,
					fontSize: 10.5,
					color: T.textFaint,
				}}
			>
				{event.owner}
			</span>
		</div>
	);
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: compact ? undefined : "100%",
				minHeight: compact ? 40 : 120,
				padding: "10px 16px",
				textAlign: "center",
				fontSize: 12,
				lineHeight: 1.5,
				color: T.textMute,
			}}
		>
			{text}
		</div>
	);
}

function SmallButton({
	onClick,
	disabled,
	tone,
	children,
}: {
	onClick: () => void;
	disabled?: boolean;
	tone?: string;
	children: React.ReactNode;
}) {
	const [hover, setHover] = useState(false);
	const lit = hover && !disabled;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				height: 24,
				padding: "0 8px",
				border: "none",
				borderRadius: 6,
				background: lit ? T.surface : "transparent",
				fontFamily: T.sans,
				fontSize: 12,
				fontWeight: 500,
				color: tone ?? (lit ? T.text : T.textDim),
				opacity: disabled ? 0.4 : 1,
				cursor: disabled ? "default" : "pointer",
				transition: "background 120ms ease, color 120ms ease",
			}}
		>
			{children}
		</button>
	);
}
