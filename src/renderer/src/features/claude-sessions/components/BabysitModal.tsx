import { useEffect, useRef, useState } from "react";
import {
	babysitRuleKindForTool,
	isBabysitArmed,
	normalizeBabysitConfig,
	type BabysitConfig,
} from "@shared/claude-sessions/babysit";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { useBabysitStore } from "../stores/useBabysitStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
	BabysitOnPill,
	BabysitRuleCards,
	configFromDraft,
	draftFromConfig,
	type BabysitDraft,
} from "./BabysitRules";

export function BabysitModal() {
	const sessionId = useBabysitStore((s) => s.modalSessionId);
	if (!sessionId) return null;
	return <BabysitDialog key={sessionId} sessionId={sessionId} />;
}

function BabysitDialog({ sessionId }: { sessionId: string }) {
	const close = useBabysitStore((s) => s.closeModal);
	const saved = useBabysitStore((s) => s.bySession[sessionId]);
	const sessionTitle = useSessionsStore((s) => s.sessions[sessionId]?.title);
	const sessionExists = useSessionsStore((s) => !!s.sessions[sessionId]);
	const queue = usePermissionsStore((s) => s.queue);

	const [draft, setDraft] = useState<BabysitDraft>(() =>
		draftFromConfig(
			useBabysitStore.getState().bySession[sessionId] ??
				useSettingsStore.getState().defaultBabysit,
		),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!sessionExists) close();
	}, [sessionExists, close]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !busy) {
				e.preventDefault();
				close();
				return;
			}
			if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (!e.metaKey) {
				const el = document.activeElement as HTMLElement | null;
				const isEditable =
					!!el &&
					(el.isContentEditable ||
						["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
				if (isEditable || el?.closest(".modal-actions")) return;
			}
			e.preventDefault();
			submitRef.current?.();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [busy, close]);

	const backdropProps = useBackdropDismiss(busy ? undefined : close);

	const active = !!saved;
	const config = configFromDraft(draft);
	const armed = isBabysitArmed(config);
	const answerMissing =
		draft.question === "answer" && draft.questionMessage.trim().length === 0;
	const dirty =
		JSON.stringify(config) !==
		JSON.stringify(normalizeBabysitConfig(saved ?? null));

	const waitingCount = queue.filter(
		(q) =>
			q.sessionId === sessionId &&
			config[babysitRuleKindForTool(q.toolName)].action !== "none",
	).length;

	const commit = async (next: BabysitConfig | null) => {
		setBusy(true);
		setError(null);
		try {
			const stored = await window.claude.setBabysit(sessionId, next);
			useBabysitStore.getState().apply(sessionId, stored);
			close();
		} catch (err) {
			setError((err as Error).message || "Couldn't update the babysitter");
			setBusy(false);
		}
	};

	const canSubmit = active
		? !busy && dirty && !answerMissing
		: !busy && armed && !answerMissing;

	useEffect(() => {
		submitRef.current = canSubmit ? () => void commit(config) : null;
	});

	let footnote: { text: string; color: string } | null = null;
	if (waitingCount > 0) {
		footnote = {
			text: `${waitingCount} prompt${waitingCount === 1 ? " is" : "s are"} waiting right now and will be answered as soon as you ${active ? "save" : "start"}.`,
			color: T.warn,
		};
	} else if (active && dirty && !armed && !answerMissing) {
		footnote = {
			text: "Everything is set to Do nothing, so saving turns the babysitter off.",
			color: T.textMute,
		};
	}

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="babysit-title"
				style={{
					width: "min(540px, calc(100vw - 32px))",
					alignSelf: "flex-start",
					marginTop: "9vh",
					maxHeight: "calc(91vh - 24px)",
					overflowY: "auto",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						marginBottom: 14,
					}}
				>
					<div style={{ minWidth: 0, flex: 1 }}>
						<h2
							id="babysit-title"
							className="modal-title"
							style={{ margin: 0 }}
						>
							Babysitter
						</h2>
						<div
							style={{
								marginTop: 2,
								fontSize: 12,
								color: T.textMute,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							Session:{" "}
							<span style={{ color: T.textDim }}>
								{sessionTitle ?? "Untitled"}
							</span>
						</div>
					</div>
					{active ? <BabysitOnPill label="On" /> : null}
				</div>

				<div style={{ marginBottom: 14 }}>
					<BabysitRuleCards draft={draft} onChange={setDraft} disabled={busy} />
				</div>

				{footnote ? (
					<div
						style={{
							margin: "0 0 12px",
							fontSize: 11.5,
							lineHeight: 1.45,
							color: footnote.color,
						}}
					>
						{footnote.text}
					</div>
				) : null}

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					{active ? (
						<button
							className="btn"
							onClick={() => void commit(null)}
							disabled={busy}
							style={{ marginRight: "auto", color: T.danger }}
						>
							Stop babysitting
						</button>
					) : null}
					<button className="btn" onClick={close} disabled={busy}>
						Cancel
					</button>
					<button
						className="btn btn-babysit"
						disabled={!canSubmit}
						onClick={() => void commit(config)}
					>
						{busy ? "…" : active ? "Save changes" : "Start babysitting"}
					</button>
				</div>
			</div>
		</div>
	);
}
