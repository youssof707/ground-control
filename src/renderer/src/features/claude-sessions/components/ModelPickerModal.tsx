import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import {
	identityMatches,
	parseModelIdentity,
	parseOptionIdentity,
} from "@shared/claude-sessions/sessionModel";
import { focusComposer } from "../lib/composerActions";

interface ModelOption {
	/** undefined = clear the override (CLI default model). */
	value: string | undefined;
	displayName: string;
	/** Version head of the CLI's `ModelInfo.description` (pre-trimmed by
	 * `firstSegment`, e.g. "Sonnet 4.6"). NOT rendered as row copy anymore —
	 * it feeds `parseOptionIdentity` (dedupe + current-row highlight) and is
	 * the Default row's subtitle, where it names the model the CLI resolves
	 * to. Omitted for our synthetic Default option. */
	description?: string;
}

/** Trim the CLI's "{version} · {tagline}" description down to just the
 * version-and-capabilities half. Splits on the first " · " (U+00B7 with
 * surrounding spaces) — the CLI's own separator — and returns the head.
 * Returns undefined for empty/missing input so the caller can skip the
 * whole line rather than render an empty span. */
function firstSegment(description: string | undefined): string | undefined {
	if (!description) return undefined;
	const idx = description.indexOf(" · ");
	const head = (idx === -1 ? description : description.slice(0, idx)).trim();
	return head.length > 0 ? head : undefined;
}

/** First-letter capitalize, for turning an identity's lowercased family
 * ("fable") into a row title ("Fable"). `sessionModel.ts` has the same
 * helper but keeps it module-private. */
function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Collapse the CLI's full model list down to the latest version per family —
 * one Opus row (5.5), one Fable row (5.1), not every point release the CLI
 * still accepts. The 1M-context variant counts as its own family (mirrors
 * `identityMatches`' exact-oneM rule), so "Sonnet 4.6 with 1M context"
 * survives independently of plain Sonnet.
 *
 * Rows that don't parse to a versioned identity — the "default" row,
 * versionless aliases like "opusplan" — can't be ranked, so they pass
 * through untouched. The winner keeps the list position where its family
 * first appeared, preserving the CLI's own ordering.
 */
function dedupeLatest(options: ModelOption[]): ModelOption[] {
	const result: ModelOption[] = [];
	const slotByFamily = new Map<string, number>();
	for (const o of options) {
		const id =
			o.value === "default" ? null : parseOptionIdentity(o.value, o.description);
		if (!id || id.major === undefined) {
			result.push(o);
			continue;
		}
		const key = `${id.family}${id.oneM ? "[1m]" : ""}`;
		const slot = slotByFamily.get(key);
		if (slot === undefined) {
			slotByFamily.set(key, result.length);
			result.push(o);
			continue;
		}
		const incumbent = result[slot];
		const incumbentId = parseOptionIdentity(
			incumbent.value,
			incumbent.description,
		);
		const better =
			incumbentId?.major === undefined ||
			id.major > incumbentId.major ||
			(id.major === incumbentId.major &&
				(id.minor ?? -1) > (incumbentId.minor ?? -1));
		if (better) result[slot] = o;
	}
	return result;
}

/** Fallback "clear override" row used only when the CLI's model list doesn't
 * itself include a "default" entry. When the CLI provides one (with a proper
 * "Default (recommended)" label + description) we surface *that* row and
 * remap its click to `undefined` — same clear-override semantics, better
 * copy. Deduping avoids the two-Default rows the user saw in the picker. */
const SYNTHETIC_DEFAULT: ModelOption = {
	value: undefined,
	displayName: "Default",
};

/**
 * Model picker used by both real sessions (via SessionTokenBar) and draft
 * sessions (via DraftSessionChat's header). Fetches the CLI's live model
 * list every time it opens — no hardcoded fallback, no cached list. For
 * sessions with a live SDK query the fetch is a control request against
 * that query; for drafts / idle sessions the main-side `supportedModels`
 * spins up a transient probe query against the same binary that would
 * spawn the real session, so the list always matches what the CLI can
 * actually run.
 *
 * If the fetch fails (CLI unreachable, binary crash, etc.) the modal
 * shows the error message instead of a fabricated list — this closes the
 * class of bug where the picker offered `fable` but the spawn then
 * rejected it because the resolved list came from a stale cache.
 *
 * Selection is delegated via `onSelect(value)` — the caller decides what
 * to do with the pick (real sessions call `setSessionModel`; drafts
 * stash the value on the draft record and forward it to `startSession`
 * on first send). Errors thrown from `onSelect` surface in the modal's
 * error slot instead of crashing.
 *
 * When `isRunning` is true (a turn is currently in flight for this session),
 * picking a model routes through `onSwitchAndResume` instead of the plain
 * `onSelect` — interrupt the running turn, set the model, and resume, all
 * in one gesture, no separate Stop click and no typing "continue" by hand.
 * See `switchModelAndResume` (lib/modelSwitchActions.ts).
 */
export function ModelPickerModal({
	open,
	sessionId,
	effectiveModel,
	subtitle = "Applies to this session only.",
	focusComposerAfterSelect = true,
	onSelect,
	onSwitchAndResume,
	isRunning,
	onClose,
}: {
	open: boolean;
	/** Session whose live query answers the model list. Omitted by the
	 * app-settings "Default model" picker (no session exists yet) — main's
	 * `supportedModels` falls back to its transient probe query in that
	 * case, the same path a draft or idle session already takes. */
	sessionId?: string;
	/** The model *actually in effect* — the same stream-derived value the
	 * footer label shows (`deriveDisplayedModel(...).model`), not the
	 * requested override. Highlighting must reflect reality: when the CLI
	 * flips the model out from under us (server-side fallback, `/model`
	 * inside the SDK), the picker has to show the model that's really
	 * running, or the row you actually want reads as already-selected and
	 * feels dead. Drafts have no stream, so they pass `draft.model`. The
	 * app-settings picker passes the saved default. */
	effectiveModel: string | undefined;
	/** Line under the title. Defaults to the per-session wording; the app
	 * settings pane overrides it since its pick has app-wide scope. */
	subtitle?: string;
	/** Hand focus back to the *main* composer after a pick, via the global
	 * `focusComposer()`. True by default (the draft header's picker, and
	 * `SessionTokenBar` when it has no `onAfterSelect` override). Two callers
	 * pass false: the app-settings picker, whose composer sits behind the
	 * still-open Settings modal and shouldn't have focus yanked out of it;
	 * and `SessionTokenBar` when the caller supplies its own `onAfterSelect`
	 * (the sidequest panel, so a pick there re-focuses the *panel's* composer
	 * instead of the main one). */
	focusComposerAfterSelect?: boolean;
	/** Called with the chosen model id, or `undefined` to clear the
	 * override. May be async; the modal disables its buttons while the
	 * promise is pending and surfaces thrown errors in the error slot. */
	onSelect: (value: string | undefined) => Promise<void> | void;
	/** Interrupt the current turn, set the model, and resume — called
	 * instead of `onSelect` when `isRunning` is true. Omitted by callers
	 * with no live turn to interrupt (drafts), where `isRunning` is always
	 * false anyway. */
	onSwitchAndResume?: (value: string | undefined) => Promise<void> | void;
	/** True when a turn is currently in flight for this session. Picking a
	 * model then routes through `onSwitchAndResume` and the modal's helper
	 * line says so up front — switching mid-response is a deliberate,
	 * fully-automatic action, not a silent side effect. */
	isRunning?: boolean;
	onClose: () => void;
}) {
	const [options, setOptions] = useState<ModelOption[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Monotonic seq — drops stale IPC responses if the modal is reopened
	// for a different session while a fetch is in flight. Matches the seq
	// pattern in AttachWorktreeModal / useSessionsBootstrap.
	const fetchSeq = useRef(0);

	useEffect(() => {
		if (!open) return;
		setError(null);
		setSaving(false);
		setOptions([]);
		setLoading(true);
		const my = ++fetchSeq.current;
		void (async () => {
			try {
				const list = await window.claude.getSupportedModels(sessionId);
				if (my !== fetchSeq.current) return;
				// Live-only: the CLI is the single source of truth for "what
				// can this binary actually spawn?" — no hardcoded fallback, no
				// cache. We then collapse the list to the latest version per
				// family (`dedupeLatest`); older point releases stay spawnable
				// via the CLI, they're just not offered.
				//
				// `description` from the CLI is a "{version} · {tagline}"
				// string (e.g. "Sonnet 4.6 · Best for everyday tasks"). We keep
				// only the version head (`firstSegment`) — it feeds identity
				// parsing and the Default row's subtitle; the tagline is
				// marketing copy we never show.
				const sdkOptions = (list ?? []).map((m: ModelInfo) => ({
					value: m.value,
					displayName: m.displayName,
					description: firstSegment(m.description),
				}));
				setOptions(dedupeLatest(sdkOptions));
			} catch (err) {
				if (my !== fetchSeq.current) return;
				console.error("[ccw] getSupportedModels failed:", err);
				setOptions([]);
				setError(
					err instanceof Error && err.message
						? `Couldn't list models: ${err.message}`
						: "Couldn't reach the Claude CLI to list models. Try again.",
				);
			} finally {
				if (my === fetchSeq.current) setLoading(false);
			}
		})();
	}, [open, sessionId]);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	const pick = async (value: string | undefined) => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			if (isRunning && onSwitchAndResume) {
				await onSwitchAndResume(value);
			} else {
				await onSelect(value);
			}
			onClose();
			// Picking a model is a one-shot detour, not a control the user
			// meant to linger on — hand focus straight back to the composer
			// so typing can continue uninterrupted. Same pattern as
			// runShortcut/runSkill in MessageComposer. Skipped by the
			// app-settings picker, whose composer sits behind the still-open
			// Settings modal.
			if (focusComposerAfterSelect) focusComposer();
		} catch (err) {
			setSaving(false);
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Treat the CLI-provided "default" entry as the clear-override affordance
	// so it can't co-exist with our synthetic Default row. Both map to
	// `undefined` when picked (no explicit `model` option → the SDK/CLI
	// resolves the default itself, same as before). The `undefined` sentinel
	// preserves prior semantics without hardcoding the string "default".
	const cliHasDefault = options.some((o) => o.value === "default");
	const rowsToRender: ModelOption[] = cliHasDefault
		? options
		: [SYNTHETIC_DEFAULT, ...options];

	const isDefaultRow = (o: ModelOption) =>
		o.value === undefined || o.value === "default";

	// Resolve the highlight to a single row index rather than testing rows
	// independently. The stream reports concrete ids ("claude-sonnet-4-5-…")
	// while rows carry CLI aliases ("sonnet", "sonnet[1m]"), so matching is
	// structural (family + version + 1M flag) and *can* hit more than one row
	// — a versionless "sonnet" alias matches any Sonnet. When it does, prefer
	// the row that names a specific version; it's the more informative claim.
	// If the effective model is an older version whose row `dedupeLatest`
	// dropped (stream says Opus 4.7, only Opus 5.5 renders), nothing matches
	// and no row highlights — intentionally honest.
	const effectiveIdentity = parseModelIdentity(effectiveModel);
	const rowIdentities = rowsToRender.map((o) =>
		isDefaultRow(o) ? null : parseOptionIdentity(o.value, o.description),
	);

	let selectedIndex = -1;
	if (effectiveIdentity === null) {
		// No model in effect at all (no override, nothing in the stream yet)
		// → the Default row is the honest answer.
		selectedIndex = rowsToRender.findIndex(isDefaultRow);
	} else {
		const matches = rowIdentities.flatMap((id, i) =>
			identityMatches(effectiveIdentity, id) ? [i] : [],
		);
		const versioned = matches.filter(
			(i) => rowIdentities[i]?.major !== undefined,
		);
		selectedIndex = (versioned.length > 0 ? versioned : matches)[0] ?? -1;
	}

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-picker-title"
			>
				<h2 id="model-picker-title" className="modal-title">
					Model
				</h2>
				<div className="modal-message">
					{subtitle}
					{isRunning && onSwitchAndResume
						? " Picking a model stops the current response and continues with it automatically."
						: ""}
				</div>

				{loading ? (
					// Loading state: spinner + label, sized to roughly match the
					// height of a populated list so the modal doesn't jump when
					// the fetch resolves. Reuses the shared `.asyncy-btn-spinner`
					// class from index.css (14×14, 0.7s spin). `role="status"` +
					// `aria-live="polite"` announces the load to screen readers.
					<div
						role="status"
						aria-live="polite"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 10,
							minHeight: 120,
							margin: "12px 0 4px",
							color: T.textMute,
							fontSize: 12,
						}}
					>
						<span className="asyncy-btn-spinner" aria-hidden />
						<span>Loading models…</span>
					</div>
				) : (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 6,
							margin: "12px 0 4px",
						}}
					>
						{rowsToRender.map((o, i) => {
							const selected = i === selectedIndex;
							// Default rows always dispatch `undefined` (no
							// explicit override) even when the row came from
							// the CLI with value === "default" — keeps the
							// prior semantics of "clear the override" intact.
							const dispatchValue = isDefaultRow(o) ? undefined : o.value;
							// Title/subtitle split: model rows with a parsed
							// versioned identity show the bare family as the
							// title ("Fable") and the full model name as the
							// subtitle ("Fable 5.1"); the 1M variant stays
							// distinguishable via its subtitle. Default rows
							// keep their label + the resolved model name;
							// unversioned oddballs ("opusplan") keep their
							// displayName as the title, no subtitle.
							const identity = rowIdentities[i];
							const versioned =
								!isDefaultRow(o) && identity?.major !== undefined;
							const title = versioned ? cap(identity.family) : o.displayName;
							const subtitle = versioned
								? o.displayName
								: isDefaultRow(o)
									? o.description
									: undefined;
							return (
								<button
									key={o.value ?? "__default__"}
									onClick={() => void pick(dispatchValue)}
									disabled={saving}
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										gap: 2,
										padding: "8px 12px",
										borderRadius: 8,
										border: `1px solid ${selected ? T.accentBorder : T.borderSoft}`,
										background: selected ? T.accentSoft : T.surfaceLow,
										color: T.text,
										cursor: saving ? "default" : "pointer",
										textAlign: "left",
										font: "inherit",
									}}
								>
									<span
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
										}}
									>
										<span style={{ fontSize: 13, fontWeight: 600 }}>
											{title}
										</span>
										{selected ? (
											<span
												style={{
													fontSize: 11,
													fontWeight: 400,
													color: T.accent,
												}}
											>
												current
											</span>
										) : null}
									</span>
									{subtitle ? (
										// Full model name ("Fable 5.1") — or, on
										// the Default row, the model the CLI
										// resolves to. Dimmed / smaller so the
										// family title stays the primary read.
										<span
											style={{
												fontSize: 11,
												fontWeight: 400,
												color: T.textMute,
												lineHeight: 1.35,
											}}
										>
											{subtitle}
										</span>
									) : null}
								</button>
							);
						})}
					</div>
				)}

				{!loading && !error && options.length === 0 ? (
					<div
						style={{
							fontSize: 12,
							color: T.textMute,
							margin: "8px 0 4px",
							fontStyle: "italic",
						}}
					>
						No models reported by the CLI.
					</div>
				) : null}

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose} disabled={saving}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
