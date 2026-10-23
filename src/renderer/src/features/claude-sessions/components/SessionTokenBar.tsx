import { useMemo, useState } from "react";
import type {
	SessionStatus,
	SessionUsage,
} from "@shared/schemas/claude_session";
import { T } from "../../../design/tokens";
import {
	deriveDisplayedModel,
	formatModelName,
	type ModelDerivable,
} from "@shared/claude-sessions/sessionModel";
import {
	estimateUsageFromTranscript,
	usageTotal,
} from "@shared/claude-sessions/sessionUsage";
import { useModelPickerStore } from "../stores/useModelPickerStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ModelPickerModal } from "./ModelPickerModal";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

/**
 * The subset of a chat-like target the token bar actually reads. A real
 * `ClaudeSessionFull` already satisfies this structurally; a sidequest —
 * which has no `useSessionsStore` row — assembles one from `SidequestState`
 * fields. Extends `ModelDerivable` (the same structural-subset pattern
 * `sessionModel.ts` already uses for `deriveDisplayedModel`) with the two
 * extra fields the bar needs beyond model derivation: an id to key the
 * picker/IPC calls on, and a status to compute `isRunning`.
 */
export interface TokenBarTarget extends ModelDerivable {
	id: string;
	/** Sidequests add a "starting" status with no session-store equivalent —
	 * treated the same as any other non-running status here. */
	status: SessionStatus | "starting";
	/** Tokens currently in the context window — the exact `/context` figure
	 * captured by `SessionManager.runLoop` (`ClaudeSession.contextTokens`;
	 * `SidequestState.contextTokens` for forks). Undefined until the first
	 * capture, in which case the count is simply not rendered. */
	contextTokens?: number;
	usage?: SessionUsage;
}

type Density = "full" | "compact";

export function SessionTokenBar({
	target,
	density = "full",
	/** Interrupt the current turn, set the model, and resume — omitted by
	 * the sidequest panel: `sendToSidequest`'s self-heal (re-fork a dead SDK
	 * loop) has no equivalent on this path, so sidequests keep the plain
	 * "just set it" behavior instead of gaining a fourth send variant. */
	onSwitchAndResume,
	/** Called after a successful pick instead of the modal's own default of
	 * refocusing the *main* composer (`ModelPickerModal`'s
	 * `focusComposerAfterSelect`) — the sidequest panel passes
	 * `openSidequestPanelAndFocus` so picking a model there doesn't yank
	 * focus out of the panel. */
	onAfterSelect,
}: {
	target: TokenBarTarget;
	density?: Density;
	onSwitchAndResume?: (value: string | undefined) => Promise<void> | void;
	onAfterSelect?: () => void;
}) {
	// Stream-derived model label — reflects the model actually producing
	// responses (self-corrects on fallback flips). While a switch awaits its
	// first response, shows the requested model dimmed/italic ("pending").
	// Deps are the fields deriveDisplayedModel actually reads — `target`'s
	// identity churns on every store update, so depending on it directly
	// would defeat the memo.
	const displayed = useMemo(
		() => deriveDisplayedModel(target),
		[target.messages, target.model, target.modelChangedAt],
	);
	const usage = useMemo(() => {
		const u = target.usage ?? estimateUsageFromTranscript(target.messages);
		return usageTotal(u) > 0 ? u : null;
	}, [target.usage, target.messages]);
	// Lifted to a store rather than local state so the global Cmd+Shift+M
	// hotkey can open this same modal instance from outside this component's
	// subtree — see useModelPickerStore.ts. Shared by both the main chat's
	// bar and the sidequest panel's; only one `openForSessionId` can match a
	// given target's id at a time, so only one modal ever renders.
	const pickerOpen = useModelPickerStore(
		(s) => s.openForSessionId === target.id,
	);
	const switching = useModelPickerStore((s) => s.switching[target.id]);
	const switchFailed = useModelPickerStore((s) => !!s.failed[target.id]);
	const [modelHover, setModelHover] = useState(false);
	const showIo = useSettingsStore((s) => s.showIoTokens ?? true);
	const showContext = useSettingsStore((s) => s.showContextTokens ?? true);
	const ioVisible = showIo && usage != null;
	const contextVisible = showContext && target.contextTokens != null;

	const labelModel = switching ? switching.model : displayed.model;
	const modelLabel = labelModel ? formatModelName(labelModel) : "Default";
	const showPending = !switching && displayed.pending;
	// awaiting_permission counts as "running" here too: a turn is still in
	// flight, just paused on a permission/plan/question card — interrupting
	// it (which switchModelAndResume does) cancels that pending decision the
	// same way the composer's own Stop button already does.
	const isRunning =
		target.status === "running" || target.status === "awaiting_permission";

	return (
		<div
			style={{
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				flexWrap: density === "compact" ? "wrap" : "nowrap",
				gap: 16,
				padding: density === "compact" ? "6px 16px 0" : "4px 32px 6px",
				fontSize: 11,
				fontFamily: T.mono,
				color: T.textMute,
				background: T.win,
				userSelect: "none",
			}}
		>
			<div
				style={{
					maxWidth: density === "compact" ? undefined : 760,
					margin: density === "compact" ? 0 : "0 auto",
					width: "100%",
					minWidth: 0,
					display: "flex",
					alignItems: "center",
				}}
			>
				<button
					onClick={() => useModelPickerStore.getState().open(target.id)}
					onMouseEnter={() => setModelHover(true)}
					onMouseLeave={() => setModelHover(false)}
					style={{
						padding: 0,
						border: "none",
						background: "none",
						font: "inherit",
						fontStyle: showPending ? "italic" : "normal",
						color: switchFailed
							? T.danger
							: switching || showPending
								? T.textMute
								: modelHover
									? T.text
									: T.textDim,
						textDecoration: modelHover ? "underline" : "none",
						textUnderlineOffset: 3,
						cursor: "pointer",
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{modelLabel}
					{switching ? (
						<span className="model-switching-dots" aria-hidden>
							<span>.</span>
							<span>.</span>
							<span>.</span>
						</span>
					) : showPending ? (
						"…"
					) : (
						""
					)}
				</button>
				{(ioVisible || contextVisible) && (
					<span
						style={{
							marginLeft: "auto",
							paddingLeft: 16,
							flexShrink: 0,
							display: "flex",
							gap: 16,
							color: T.textMute,
						}}
					>
						{ioVisible && usage != null && (
							<>
								<span>
									Input:{" "}
									<span style={{ color: T.textDim }}>
										{fmtTokens(usage.input)} tok
									</span>
								</span>
								<span>
									Output:{" "}
									<span style={{ color: T.textDim }}>
										{fmtTokens(usage.output)} tok
									</span>
								</span>
							</>
						)}
						{contextVisible && target.contextTokens != null && (
							<span>
								Context:{" "}
								<span style={{ color: T.textDim }}>
									{fmtTokens(target.contextTokens)} tok
								</span>
							</span>
						)}
					</span>
				)}
			</div>
			<ModelPickerModal
				open={pickerOpen}
				sessionId={target.id}
				effectiveModel={displayed.model}
				isRunning={isRunning}
				focusComposerAfterSelect={!onAfterSelect}
				onSelect={(value) => {
					onAfterSelect?.();
					return useModelPickerStore
						.getState()
						.runSwitch(target.id, value, () =>
							window.claude.setSessionModel(target.id, value),
						);
				}}
				onSwitchAndResume={
					onSwitchAndResume
						? (value) => {
							onAfterSelect?.();
							return useModelPickerStore
								.getState()
								.runSwitch(target.id, value, () => onSwitchAndResume(value));
						}
						: undefined
				}
				onClose={() => useModelPickerStore.getState().close()}
			/>
		</div>
	);
}
