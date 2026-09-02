import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
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
	/** Secondary line under the name — carries the version/tagline the CLI
	 * ships in `ModelInfo.description` (e.g. "Sonnet 4.6 · Best for everyday
	 * tasks"). Omitted for our synthetic Default option; skipped in render
	 * when absent. */
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
 */
export function ModelPickerModal({
	open,
	sessionId,
	effectiveModel,
	onSelect,
	onClose,
}: {
	open: boolean;
	sessionId: string;
	/** The model *actually in effect* — the same stream-derived value the
	 * footer label shows (`deriveDisplayedModel(...).model`), not the
	 * requested override. Highlighting must reflect reality: when the CLI
	 * flips the model out from under us (server-side fallback, `/model`
	 * inside the SDK), the picker has to show the model that's really
	 * running, or the row you actually want reads as already-selected and
	 * feels dead. Drafts have no stream, so they pass `draft.model`. */
	effectiveModel: string | undefined;
	/** Called with the chosen model id, or `undefined` to clear the
	 * override. May be async; the modal disables its buttons while the
	 * promise is pending and surfaces thrown errors in the error slot. */
	onSelect: (value: string | undefined) => Promise<void> | void;
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
				// Live-only: whatever the CLI reports is what we render, in the
				// order it returned. No merging with a hardcoded list, no
				// dedupe against a fallback — the CLI is the single source of
				// truth for "what can this binary actually spawn?"
				//
				// `description` from the CLI is a "{version} · {tagline}"
				// string (e.g. "Sonnet 4.6 · Best for everyday tasks",
				// "Opus 4.7 with 1M context · Most capable for complex work",
				// "Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15
				// per Mtok"). We only want the version-and-capabilities part —
				// the tagline is marketing copy that clutters the row — so we
				// split on " · " and keep the first segment. Preserves multi-
				// dot version strings (the split is on the *first* separator).
				const sdkOptions = (list ?? []).map((m: ModelInfo) => ({
					value: m.value,
					displayName: m.displayName,
					description: firstSegment(m.description),
				}));
				setOptions(sdkOptions);
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

	if (!open) return null;

	const pick = async (value: string | undefined) => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await onSelect(value);
			onClose();
			// Picking a model is a one-shot detour, not a control the user
			// meant to linger on — hand focus straight back to the composer
			// so typing can continue uninterrupted. Same pattern as
			// runShortcut/runSkill in ImagePasteTextarea.
			focusComposer();
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
		<div className="modal-backdrop" onClick={onClose} role="presentation">
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-picker-title"
			>
				<h2 id="model-picker-title" className="modal-title">
					Model
				</h2>
				<div className="modal-message">Applies to this session only.</div>

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
											{o.displayName}
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
									{o.description ? (
										// Version + tagline from the CLI (e.g.
										// "Sonnet 4.6 · Best for everyday tasks").
										// Dimmed / smaller so the display name
										// stays the primary read.
										<span
											style={{
												fontSize: 11,
												fontWeight: 400,
												color: T.textMute,
												lineHeight: 1.35,
											}}
										>
											{o.description}
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
