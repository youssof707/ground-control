import { useEffect, useRef, useState } from "react";
import { isBabysitArmed } from "@shared/claude-sessions/babysit";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { Kbd } from "../../../design/Atoms";
import { TabStrip } from "../../../design/TabStrip";
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
import { McpServersPanel } from "./McpServersPanel";
import { DeveloperPanel } from "./DeveloperPanel";
import { Section } from "./SettingsSection";
import {
	useSettingsModalStore,
	type SettingsTab,
} from "../stores/useSettingsModalStore";

const SHORTCUTS: { keys: string[]; label: string }[] = [
	{ keys: ["⌘", "N"], label: "New session" },
	{ keys: ["⌘", "S"], label: "Open a side quest" },
	{ keys: ["⌘", "K"], label: "Open the shortcut menu" },
	{ keys: ["⌘", "R"], label: "Quote selection into the composer" },
	{ keys: ["⌘", "."], label: "Stop the running session" },
	{ keys: ["⌘", "P"], label: "Toggle plan mode (in the composer)" },
	{ keys: ["⌘", "D"], label: "Start / stop voice dictation" },
	{ keys: ["⌘", "⇧", "B"], label: "Open the babysitter" },
	{ keys: ["⌘", "⇧", "S"], label: "Open the scheduler" },
	{ keys: ["⌘", "⇧", "M"], label: "Open the model picker" },
	{ keys: ["⌘", "⇧", "T"], label: "Restore the most recently deleted session" },
	{ keys: ["⌘", "⌫"], label: "Delete the open session" },
];

const BABYSIT_AUTOSAVE_DELAY_MS = 400;

type AutoStartValue = "off" | "on";

const AUTO_START_OPTIONS = [
	{ value: "off", label: "Off", tone: T.textDim },
	{ value: "on", label: "On", tone: T.babysit },
] as const satisfies readonly { value: AutoStartValue; label: string; tone: string }[];

type VisibilityValue = "hidden" | "shown";

const VISIBILITY_OPTIONS = [
	{ value: "hidden", label: "Hidden", tone: T.textDim },
	{ value: "shown", label: "Shown", tone: T.text },
] as const satisfies readonly { value: VisibilityValue; label: string; tone: string }[];

export function SettingsModal() {
	const openTab = useSettingsModalStore((s) => s.openTab);
	const mcpCwd = useSettingsModalStore((s) => s.mcpCwd);
	const close = useSettingsModalStore((s) => s.close);
	if (!openTab) return null;
	return (
		<SettingsDialog
			key={`${openTab}:${mcpCwd ?? ""}`}
			initialTab={openTab}
			initialMcpCwd={mcpCwd}
			onClose={close}
		/>
	);
}

function SettingsDialog({
	initialTab,
	initialMcpCwd,
	onClose,
}: {
	initialTab: SettingsTab;
	initialMcpCwd: string | null;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<SettingsTab>(initialTab);
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

	const modelLabel = modelButtonLabel(defaultModel);

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
						idPrefix="settings"
						ariaLabel="Settings sections"
						value={tab}
						onChange={setTab}
						tabs={[
							{ id: "general", label: "General" },
							{
								id: "babysitter",
								label: "Babysitter",
								accent: T.babysit,
							},
							{ id: "mcp", label: "MCP servers" },
							{ id: "developer", label: "Developer" },
						]}
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
						) : tab === "mcp" ? (
							<McpServersPanel initialCwd={initialMcpCwd} />
						) : tab === "developer" ? (
							<DeveloperPanel />
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

function GeneralPanel({
	modelLabel,
	onPickModel,
}: {
	modelLabel: string;
	onPickModel: () => void;
}) {
	const showIo = useSettingsStore((s) => s.showIoTokens ?? true);
	const setShowIo = useSettingsStore((s) => s.setShowIoTokens);
	const showContext = useSettingsStore((s) => s.showContextTokens ?? true);
	const setShowContext = useSettingsStore((s) => s.setShowContextTokens);

	return (
		<>
			<Section title="Default model">
				<ModelPickerButton label={modelLabel} onClick={onPickModel} />
			</Section>

			<Section title="Token bar">
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<VisibilityRow
						label="Input / output tokens"
						shown={showIo}
						onChange={setShowIo}
					/>
					<VisibilityRow
						label="Context tokens"
						shown={showContext}
						onChange={setShowContext}
					/>
				</div>
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

export function modelButtonLabel(model: string | undefined): string {
	return model
		? formatModelName(model) +
				(parseModelIdentity(model)?.oneM ? " · 1M context" : "")
		: "Default";
}

export function ModelPickerButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			aria-haspopup="dialog"
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				alignSelf: "flex-start",
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				maxWidth: 280,
				padding: "5px 8px 5px 10px",
				borderRadius: 7,
				border: `0.5px solid ${hover ? T.textFaint : T.border}`,
				background: hover ? T.surface : T.bg,
				fontFamily: T.mono,
				fontSize: 12,
				color: T.text,
				cursor: "pointer",
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
			<svg
				width="8"
				height="8"
				viewBox="0 0 8 8"
				fill="none"
				aria-hidden
				style={{
					flexShrink: 0,
					color: hover ? T.textDim : T.textMute,
					transition: "color 120ms ease",
				}}
			>
				<path
					d="M1.5 2.75L4 5.25L6.5 2.75"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}

function VisibilityRow({
	label,
	shown,
	onChange,
}: {
	label: string;
	shown: boolean;
	onChange: (shown: boolean) => void;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 12,
			}}
		>
			<span style={{ fontSize: 12.5, color: T.text }}>{label}</span>
			<Segmented<VisibilityValue>
				label={label}
				value={shown ? "shown" : "hidden"}
				options={VISIBILITY_OPTIONS}
				onChange={(value) => onChange(value === "shown")}
			/>
		</div>
	);
}
