import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { T } from "../../../design/tokens";
import { FALLBACK_MODELS, normalizeModelId } from "../lib/sessionModel";

interface ModelOption {
	/** undefined = clear the override (CLI default model). */
	value: string | undefined;
	displayName: string;
}

const DEFAULT_OPTION: ModelOption = {
	value: undefined,
	displayName: "Default",
};

/**
 * Per-session model picker. Fetches the SDK's own model list via the
 * session's live query when one exists; falls back to a static list for
 * done/errored sessions (the selection still round-trips through the SDK
 * on the next resume, which validates the id for real).
 */
export function ModelPickerModal({
	open,
	sessionId,
	currentModel,
	onClose,
}: {
	open: boolean;
	sessionId: string;
	/** The session's *requested* override (`session.model`), not the
	 * stream-derived label — highlighting reflects what's been asked for. */
	currentModel: string | undefined;
	onClose: () => void;
}) {
	const [options, setOptions] = useState<ModelOption[]>(FALLBACK_MODELS);
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
		setLoading(true);
		const my = ++fetchSeq.current;
		void (async () => {
			try {
				const list = await window.claude.getSupportedModels(sessionId);
				if (my !== fetchSeq.current) return;
				if (list && list.length > 0) {
					setOptions(
						list.map((m: ModelInfo) => ({
							value: m.value,
							displayName: m.displayName,
						})),
					);
				} else {
					// No live SDK query (done/errored session) → static list.
					setOptions(FALLBACK_MODELS);
				}
			} catch (err) {
				if (my !== fetchSeq.current) return;
				console.error("[ccw] getSupportedModels failed:", err);
				setOptions(FALLBACK_MODELS);
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

	const normalizedCurrent = currentModel
		? normalizeModelId(currentModel)
		: undefined;

	const pick = async (value: string | undefined) => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await window.claude.setSessionModel(sessionId, value);
			onClose();
		} catch (err) {
			setSaving(false);
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const isSelected = (o: ModelOption) =>
		o.value === undefined
			? normalizedCurrent === undefined
			: normalizedCurrent === normalizeModelId(o.value);

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
				<div className="modal-message">
					Applies to this session only{loading ? " — loading models…" : ""}.
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 6,
						margin: "12px 0 4px",
					}}
				>
					{[DEFAULT_OPTION, ...options].map((o) => {
						const selected = isSelected(o);
						return (
							<button
								key={o.value ?? "__default__"}
								onClick={() => void pick(o.value)}
								disabled={saving}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
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
							</button>
						);
					})}
				</div>

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
