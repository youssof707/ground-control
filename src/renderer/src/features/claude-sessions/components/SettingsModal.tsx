import { useEffect, useRef, useState } from "react";
import { isBabysitArmed } from "@shared/claude-sessions/babysit";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { Kbd } from "../../../design/Atoms";
import { T } from "../../../design/tokens";
import {
	formatModelName,
	parseModelIdentity,
} from "@shared/claude-sessions/sessionModel";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
	BabysitRuleCards,
	Segmented,
	configFromDraft,
	draftFromConfig,
	type BabysitDraft,
} from "./BabysitRules";
import { ModelPickerModal } from "./ModelPickerModal";

const SHORTCUTS: { keys: string[]; label: string }[] = [
	{ keys: ["⌘", "N"], label: "New session" },
	{ keys: ["⌘", "S"], label: "Open a side quest" },
	{ keys: ["⌘", "K"], label: "Open the shortcut menu" },
	{ keys: ["⌘", "R"], label: "Quote selection into the composer" },
	{ keys: ["⌘", "."], label: "Stop the running session" },
	{ keys: ["⌘", "P"], label: "Toggle plan mode (in the composer)" },
	{ keys: ["⌘", "D"], label: "Start / stop voice dictation" },
	{ keys: ["⌘", "⇧", "B"], label: "Open the babysitter" },
	{ keys: ["⌘", "⇧", "M"], label: "Open the model picker" },
	{ keys: ["⌘", "⇧", "Z"], label: "Restore the most recently deleted session" },
];

const BABYSIT_AUTOSAVE_DELAY_MS = 400;

type SettingsTab = "general" | "babysitter";

type AutoStartValue = "off" | "on";

const AUTO_START_OPTIONS = [
	{ value: "off", label: "Off", tone: T.textDim },
	{ value: "on", label: "On", tone: T.babysit },
] as const satisfies readonly { value: AutoStartValue; label: string; tone: string }[];

export function SettingsModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	if (!open) return null;
	return <SettingsDialog onClose={onClose} />;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
	const [tab, setTab] = useState<SettingsTab>("general");
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const defaultModel = useSettingsStore((s) => s.defaultModel);
	const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
	const autoStart = useSettingsStore((s) => s.autoBabysitNewSessions ?? false);
	const setAutoStart = useSettingsStore((s) => s.setAutoBabysitNewSessions);

	const [babysitDraft, setBabysitDraft] = useState<BabysitDraft>(() =>
		draftFromConfig(useSettingsStore.getState().defaultBabysit),
	);
	const babysitConfig = configFromDraft(babysitDraft);
	const babysitArmed = isBabysitArmed(babysitConfig);
	useAutosavedBabysitDefaults(babysitConfig);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (modelPickerOpen) return;
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose, modelPickerOpen]);

	const backdropProps = useBackdropDismiss(onClose);

	const modelLabel = defaultModel
		? formatModelName(defaultModel) +
			(parseModelIdentity(defaultModel)?.oneM ? " · 1M context" : "")
		: "Default";

	return (
		<>
			<div className="modal-backdrop" {...backdropProps}>
				<div
					className="modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="settings-title"
					style={{
						width: "min(560px, calc(100vw - 32px))",
						height: "min(640px, calc(91vh - 24px))",
						alignSelf: "flex-start",
						marginTop: "9vh",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						boxSizing: "border-box",
					}}
				>
					<h2 id="settings-title" className="modal-title" style={{ margin: 0 }}>
						Settings
					</h2>

					<TabStrip
						tab={tab}
						onChange={setTab}
						autoStart={autoStart}
					/>

					<div
						role="tabpanel"
						aria-labelledby={`settings-tab-${tab}`}
						style={{
							flex: 1,
							minHeight: 0,
							overflowY: "auto",
							margin: "0 -22px",
							padding: "18px 22px 4px",
						}}
					>
						{tab === "general" ? (
							<GeneralPanel
								modelLabel={modelLabel}
								onPickModel={() => setModelPickerOpen(true)}
							/>
						) : (
							<BabysitterPanel
								draft={babysitDraft}
								onChange={setBabysitDraft}
								armed={babysitArmed}
								autoStart={autoStart}
								onAutoStartChange={setAutoStart}
							/>
						)}
					</div>

					<div
						className="modal-actions"
						style={{
							margin: "0 -22px",
							padding: "14px 22px 0",
							borderTop: `0.5px solid ${T.borderSoft}`,
						}}
					>
						<button className="btn" onClick={onClose}>
							Done
						</button>
					</div>
				</div>
			</div>

			<ModelPickerModal
				open={modelPickerOpen}
				effectiveModel={defaultModel}
				subtitle="Applies to new sessions. Existing sessions keep their own model."
				focusComposerAfterSelect={false}
				onSelect={(value) => setDefaultModel(value)}
				onClose={() => setModelPickerOpen(false)}
			/>
		</>
	);
}

function useAutosavedBabysitDefaults(
	config: ReturnType<typeof configFromDraft>,
) {
	const latest = useRef(config);
	latest.current = config;
	const serialized = JSON.stringify(config);

	useEffect(() => {
		const timer = setTimeout(
			() => useSettingsStore.getState().setDefaultBabysit(latest.current),
			BABYSIT_AUTOSAVE_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [serialized]);

	useEffect(
		() => () => useSettingsStore.getState().setDefaultBabysit(latest.current),
		[],
	);
}

function TabStrip({
	tab,
	onChange,
	autoStart,
}: {
	tab: SettingsTab;
	onChange: (tab: SettingsTab) => void;
	autoStart: boolean;
}) {
	return (
		<div
			role="tablist"
			aria-label="Settings sections"
			style={{
				display: "flex",
				gap: 20,
				margin: "14px -22px 0",
				padding: "0 22px",
				borderBottom: `0.5px solid ${T.border}`,
			}}
		>
			<Tab
				id="general"
				label="General"
				active={tab === "general"}
				accent={T.text}
				onClick={() => onChange("general")}
			/>
			<Tab
				id="babysitter"
				label="Babysitter"
				active={tab === "babysitter"}
				accent={T.babysit}
				onClick={() => onChange("babysitter")}
				indicator={autoStart}
			/>
		</div>
	);
}

function Tab({
	id,
	label,
	active,
	accent,
	onClick,
	indicator,
}: {
	id: SettingsTab;
	label: string;
	active: boolean;
	accent: string;
	onClick: () => void;
	indicator?: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			role="tab"
			id={`settings-tab-${id}`}
			aria-selected={active}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				appearance: "none",
				border: "none",
				background: "none",
				padding: "10px 0 11px",
				fontFamily: "inherit",
				fontSize: 13,
				fontWeight: active ? 600 : 500,
				color: active || hover ? T.text : T.textDim,
				cursor: "pointer",
				transition: "color 80ms ease",
			}}
		>
			{label}
			{indicator ? (
				<span
					aria-hidden
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: T.babysit,
						boxShadow: `0 0 0 3px ${T.babysitSoft}`,
					}}
				/>
			) : null}
			<span
				aria-hidden
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: -0.5,
					height: 2,
					borderRadius: 1,
					background: accent,
					opacity: active ? 1 : 0,
					transform: active ? "scaleX(1)" : "scaleX(0.6)",
					transition: "opacity 120ms ease, transform 120ms ease",
				}}
			/>
		</button>
	);
}

function GeneralPanel({
	modelLabel,
	onPickModel,
}: {
	modelLabel: string;
	onPickModel: () => void;
}) {
	return (
		<>
			<Section title="Default model">
				<ModelPickerButton label={modelLabel} onClick={onPickModel} />
			</Section>

			<Section title="Keyboard shortcuts">
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{SHORTCUTS.map((sc) => (
						<div
							key={sc.label}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "4px 2px",
							}}
						>
							<div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
								{sc.keys.map((k, i) => (
									<Kbd key={i}>{k}</Kbd>
								))}
							</div>
							<span style={{ fontSize: 12.5, color: T.text }}>{sc.label}</span>
						</div>
					))}
				</div>
			</Section>
		</>
	);
}

function BabysitterPanel({
	draft,
	onChange,
	armed,
	autoStart,
	onAutoStartChange,
}: {
	draft: BabysitDraft;
	onChange: (update: (draft: BabysitDraft) => BabysitDraft) => void;
	armed: boolean;
	autoStart: boolean;
	onAutoStartChange: (on: boolean) => void;
}) {
	const answerMissing =
		draft.question === "answer" && draft.questionMessage.trim().length === 0;

	return (
		<>
			<div
				style={{
					display: "flex",
					alignItems: "flex-start",
					gap: 12,
					marginBottom: 14,
				}}
			>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
						Defaults for new sessions
					</div>
					<div
						style={{
							marginTop: 4,
							fontSize: 12,
							lineHeight: 1.5,
							color: T.textMute,
						}}
					>
						These rules prefill the babysitter whenever you start one from a
						session's ⋯ menu or{" "}
						<span
							style={{
								display: "inline-flex",
								gap: 2,
								verticalAlign: "middle",
							}}
						>
							<Kbd>⌘</Kbd>
							<Kbd>⇧</Kbd>
							<Kbd>B</Kbd>
						</span>
						. Turn auto-start on to babysit every new session with them.
					</div>
				</div>
				<Segmented<AutoStartValue>
					label="Auto-start babysitter for new sessions"
					value={autoStart ? "on" : "off"}
					options={AUTO_START_OPTIONS}
					onChange={(value) => onAutoStartChange(value === "on")}
				/>
			</div>

			<BabysitRuleCards draft={draft} onChange={onChange} />

			<div
				style={{
					marginTop: 12,
					fontSize: 11.5,
					lineHeight: 1.45,
					color: answerMissing ? T.warn : T.textMute,
				}}
			>
				{answerMissing
					? "Questions need an answer before they can be handled — until then they're left for you."
					: !autoStart
						? "Changes save automatically. New sessions start without a babysitter until you turn one on."
						: armed
							? "Every new session starts babysat with these rules. Sessions that already exist keep their current babysitter."
							: "Auto-start is on, but every rule is Do nothing, so new sessions start without a babysitter."}
			</div>
		</>
	);
}

function ModelPickerButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				alignSelf: "flex-start",
				padding: 0,
				border: "none",
				background: "none",
				fontFamily: T.mono,
				fontSize: 12,
				color: hover ? T.text : T.textDim,
				textDecoration: hover ? "underline" : "none",
				textUnderlineOffset: 3,
				cursor: "pointer",
			}}
		>
			{label}
		</button>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div style={{ marginBottom: 16 }}>
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
				{title}
			</div>
			{children}
		</div>
	);
}
