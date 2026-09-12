import { useMemo, useState } from "react";
import type { SessionMessage, SessionStatus } from "@shared/schemas/claude_session";
import { T } from "../../../design/tokens";
import {
	deriveDisplayedModel,
	formatModelName,
	type ModelDerivable,
} from "@shared/claude-sessions/sessionModel";
import { useModelPickerStore } from "../stores/useModelPickerStore";
import { ModelPickerModal } from "./ModelPickerModal";

// ─── Shapes pulled from the Claude Agent SDK message stream ──────────────────

interface ResultUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface ResultContent {
	type: "result";
	usage?: ResultUsage;
}

function isResult(
	m: SessionMessage,
): m is SessionMessage & { content: ResultContent } {
	if (m.role !== "result") return false;
	const c = m.content;
	return (
		typeof c === "object" &&
		c !== null &&
		(c as { type?: unknown }).type === "result"
	);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
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
	const totalTokens = useMemo(() => {
		// Per-turn `result` messages from the SDK report usage for that turn
		// only (verified empirically against persisted sessions), so we sum
		// them to get the session-wide total.
		let totalIn = 0;
		let totalOut = 0;
		let totalCacheRead = 0;
		let totalCacheCreation = 0;
		for (const m of target.messages) {
			if (!isResult(m)) continue;
			const u = m.content.usage;
			if (!u) continue;
			totalIn += u.input_tokens ?? 0;
			totalOut += u.output_tokens ?? 0;
			totalCacheRead += u.cache_read_input_tokens ?? 0;
			totalCacheCreation += u.cache_creation_input_tokens ?? 0;
		}
		return totalIn + totalOut + totalCacheRead + totalCacheCreation;
	}, [target.messages]);

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
	// Lifted to a store rather than local state so the global Cmd+Shift+M
	// hotkey can open this same modal instance from outside this component's
	// subtree — see useModelPickerStore.ts. Shared by both the main chat's
	// bar and the sidequest panel's; only one `openForSessionId` can match a
	// given target's id at a time, so only one modal ever renders.
	const pickerOpen = useModelPickerStore(
		(s) => s.openForSessionId === target.id,
	);
	const [modelHover, setModelHover] = useState(false);

	const modelLabel = displayed.model
		? formatModelName(displayed.model)
		: "Default";
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
				<span style={{ color: T.textDim, flexShrink: 0 }}>
					{fmtTokens(totalTokens)} tok
				</span>
				<button
					onClick={() => useModelPickerStore.getState().open(target.id)}
					onMouseEnter={() => setModelHover(true)}
					onMouseLeave={() => setModelHover(false)}
					style={{
						marginLeft: 12,
						padding: 0,
						border: "none",
						background: "none",
						font: "inherit",
						fontStyle: displayed.pending ? "italic" : "normal",
						color: displayed.pending
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
					{displayed.pending ? "…" : ""}
				</button>
			</div>
			<ModelPickerModal
				open={pickerOpen}
				sessionId={target.id}
				effectiveModel={displayed.model}
				isRunning={isRunning}
				focusComposerAfterSelect={!onAfterSelect}
				onSelect={async (value) => {
					await window.claude.setSessionModel(target.id, value);
					onAfterSelect?.();
				}}
				onSwitchAndResume={
					onSwitchAndResume
						? async (value) => {
							await onSwitchAndResume(value);
							onAfterSelect?.();
						}
						: undefined
				}
				onClose={() => useModelPickerStore.getState().close()}
			/>
		</div>
	);
}
