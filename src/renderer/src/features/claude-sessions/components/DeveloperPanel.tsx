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

const SOURCE_TONES: Record<ActivitySource, string> = {
	pmset: T.info,
	caffeinate: T.warn,
	babysitter: T.babysit,
	"auto-resume": T.ok,
	schedule: T.accent,
	power: T.textDim,
};

const SOURCE_LABELS: Record<ActivitySource, string> = {
	pmset: "pmset",
	caffeinate: "caffeinate",
	babysitter: "babysitter",
	"auto-resume": "resume",
	schedule: "schedule",
	power: "power",
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

export function DeveloperPanel() {
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<ActivityLogSection />
			<CaffeinateSection />
			<PmsetScheduleSection />
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

	return (
		<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
				<SourceFilterBar value={filter} onChange={setFilter} />
			</Section>

			<div
				role="log"
				aria-label="Activity log entries"
				style={{
					flex: 1,
					minHeight: 180,
					marginTop: -6,
					border: `0.5px solid ${T.border}`,
					borderRadius: 8,
					background: T.bg,
					overflowY: "auto",
				}}
			>
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
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					gap: 12,
					padding: "6px 2px 0",
					fontSize: 11,
					color: T.textFaint,
				}}
			>
				<span style={{ fontFamily: T.mono }}>{path ? fileName(path) : ""}</span>
				<span>
					{visible.length} {visible.length === 1 ? "event" : "events"}
				</span>
			</div>
		</div>
	);
}

function LogRows({ entries }: { entries: ActivityEntry[] }) {
	return (
		<>
			{entries.map((e, i) => {
				const showDay = i === 0 || startOfDay(entries[i - 1].at) !== startOfDay(e.at);
				return (
					<Fragment key={`${e.at}:${i}`}>
						{showDay ? <DayDivider label={dayLabel(e.at)} first={i === 0} /> : null}
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "84px 78px 1fr",
								alignItems: "baseline",
								gap: 10,
								padding: "4px 12px",
							}}
						>
							<span
								style={{
									fontFamily: T.mono,
									fontSize: 10.5,
									color: T.textMute,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{clockTime(e.at, true)}
							</span>
							<SourceTag source={e.source} />
							<span
								style={{
									minWidth: 0,
									fontSize: 12,
									lineHeight: 1.45,
									color: T.text,
									overflowWrap: "anywhere",
								}}
							>
								{e.message}
							</span>
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
				padding: "6px 12px 4px",
				marginTop: first ? 0 : 4,
				background: T.bg,
				borderBottom: `0.5px solid ${T.borderSoft}`,
				fontSize: 10,
				fontWeight: 600,
				letterSpacing: 0.5,
				textTransform: "uppercase",
				color: T.textFaint,
			}}
		>
			{label}
		</div>
	);
}

function SourceTag({ source }: { source: ActivitySource }) {
	const tone = SOURCE_TONES[source];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				fontSize: 11,
				color: tone,
				whiteSpace: "nowrap",
			}}
		>
			<span
				aria-hidden
				style={{ width: 5, height: 5, borderRadius: "50%", background: tone, flexShrink: 0 }}
			/>
			{SOURCE_LABELS[source]}
		</span>
	);
}

function SourceFilterBar({
	value,
	onChange,
}: {
	value: SourceFilter;
	onChange: (value: SourceFilter) => void;
}) {
	const options: { value: SourceFilter; label: string; tone: string }[] = [
		{ value: "all", label: "All", tone: T.text },
		...ACTIVITY_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s], tone: SOURCE_TONES[s] })),
	];
	return (
		<div
			role="radiogroup"
			aria-label="Filter by source"
			style={{
				display: "flex",
				padding: 2,
				gap: 2,
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				background: T.bg,
			}}
		>
			{options.map((o) => (
				<FilterItem
					key={o.value}
					label={o.label}
					tone={o.tone}
					active={o.value === value}
					onClick={() => onChange(o.value)}
				/>
			))}
		</div>
	);
}

function FilterItem({
	label,
	tone,
	active,
	onClick,
}: {
	label: string;
	tone: string;
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
				flex: 1,
				height: 24,
				padding: "0 6px",
				border: "none",
				borderRadius: 6,
				background: active ? T.surfaceHi : hover ? T.surfaceLow : "transparent",
				fontFamily: T.sans,
				fontSize: 11.5,
				fontWeight: active ? 600 : 500,
				color: active ? tone : hover ? T.textDim : T.textMute,
				cursor: "pointer",
				whiteSpace: "nowrap",
				transition: "background 120ms ease, color 120ms ease",
			}}
		>
			{label}
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
		<div style={{ flexShrink: 0, marginTop: 18 }}>
			<Section
				title="Active caffeinate"
				actions={
					<SmallButton onClick={refresh} disabled={loading}>
						Refresh
					</SmallButton>
				}
			>
				<div
					style={{
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						background: T.bg,
						maxHeight: 132,
						overflowY: "auto",
					}}
				>
					{processes === undefined ? (
						<EmptyState text="Loading…" compact />
					) : processes.length === 0 ? (
						<EmptyState text="Nothing is keeping the Mac awake" compact />
					) : (
						processes.map((p, i) => <CaffeinateRow key={p.pid} process={p} first={i === 0} />)
					)}
				</div>
			</Section>
		</div>
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
				gridTemplateColumns: "84px 64px 1fr auto",
				alignItems: "baseline",
				gap: 10,
				padding: "6px 12px",
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
		<div style={{ flexShrink: 0, marginTop: 18 }}>
			<Section
				title="Scheduled wakes"
				actions={
					<SmallButton onClick={refresh} disabled={loading}>
						Refresh
					</SmallButton>
				}
			>
				<div
					style={{
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						background: T.bg,
						maxHeight: 132,
						overflowY: "auto",
					}}
				>
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
				</div>
			</Section>
		</div>
	);
}

function PmsetRow({ event, first }: { event: PmsetEvent; first: boolean }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "84px 64px 48px 1fr",
				alignItems: "baseline",
				gap: 10,
				padding: "6px 12px",
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
