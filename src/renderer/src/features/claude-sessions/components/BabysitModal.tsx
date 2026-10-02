import { useEffect, useState } from "react";
import {
	BABYSIT_MESSAGE_MAX_LENGTH,
	babysitRuleKindForTool,
	isBabysitArmed,
	normalizeBabysitConfig,
	type BabysitConfig,
	type BabysitRuleKind,
} from "@shared/claude-sessions/babysit";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { useBabysitStore } from "../stores/useBabysitStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";

type GateChoice = "none" | "approve" | "deny";
type QuestionChoice = "none" | "answer";

/**
 * The form's working copy. Each rule's choice and its message are stored
 * side by side (rather than as the `BabysitConfig` union) so text the user
 * typed survives flipping a rule to another option and back.
 */
interface Draft {
	plan: GateChoice;
	planMessage: string;
	permission: GateChoice;
	permissionMessage: string;
	question: QuestionChoice;
	questionMessage: string;
}

function draftFromConfig(config: BabysitConfig | undefined): Draft {
	return {
		plan: config?.plan.action ?? "none",
		planMessage: config?.plan.action === "deny" ? config.plan.message : "",
		permission: config?.permission.action ?? "none",
		permissionMessage:
			config?.permission.action === "deny" ? config.permission.message : "",
		question: config?.question.action ?? "none",
		questionMessage:
			config?.question.action === "answer" ? config.question.message : "",
	};
}

function configFromDraft(draft: Draft): BabysitConfig {
	const gate = (choice: GateChoice, message: string) =>
		choice === "deny"
			? ({ action: "deny", message } as const)
			: ({ action: choice } as const);
	return normalizeBabysitConfig({
		plan: gate(draft.plan, draft.planMessage),
		permission: gate(draft.permission, draft.permissionMessage),
		question:
			draft.question === "answer"
				? { action: "answer", message: draft.questionMessage }
				: { action: "none" },
	});
}

// The selected segment's text colour carries the meaning, so the three rows
// can be read at a glance: neutral = waits for you, green = let through,
// red = turned away, orchid = the babysitter speaks for you.
const GATE_OPTIONS = [
	{ value: "none", label: "Do nothing", tone: T.text },
	{ value: "approve", label: "Approve", tone: T.ok },
	{ value: "deny", label: "Deny", tone: T.danger },
] as const;

const QUESTION_OPTIONS = [
	{ value: "none", label: "Do nothing", tone: T.text },
	{ value: "answer", label: "Answer", tone: T.babysit },
] as const;

/**
 * Per-session Babysitter settings: how Ground Control should answer Claude's
 * plan approvals, permission requests and questions while the user is away.
 *
 * Mounted once in `SessionsList`; open ⇔ `useBabysitStore.modalSessionId` is
 * set (by the row's ⋯ menu or its babysitting badge). Follows the same
 * `.modal-backdrop` / `.modal-card` shell as the app's other modals — there
 * is no shared `Modal` wrapper in this repo.
 *
 * Nothing here is persisted: saving sends the config to main's in-memory
 * `Babysitter`, which answers prompts until the app quits or it is stopped.
 */
export function BabysitModal() {
	const sessionId = useBabysitStore((s) => s.modalSessionId);
	if (!sessionId) return null;
	// Keyed so every open starts from a fresh draft — no reset effect needed.
	return <BabysitDialog key={sessionId} sessionId={sessionId} />;
}

function BabysitDialog({ sessionId }: { sessionId: string }) {
	const close = useBabysitStore((s) => s.closeModal);
	const saved = useBabysitStore((s) => s.bySession[sessionId]);
	const sessionTitle = useSessionsStore((s) => s.sessions[sessionId]?.title);
	const sessionExists = useSessionsStore((s) => !!s.sessions[sessionId]);
	const queue = usePermissionsStore((s) => s.queue);

	const [draft, setDraft] = useState<Draft>(() =>
		draftFromConfig(useBabysitStore.getState().bySession[sessionId]),
	);
	// Which rule the user just switched, so only ITS message field grabs
	// focus. Plain `autoFocus` on every field would fight on open when
	// several rules already have one showing.
	const [justSwitched, setJustSwitched] = useState<BabysitRuleKind | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// The session was deleted out from under the modal.
	useEffect(() => {
		if (!sessionExists) close();
	}, [sessionExists, close]);

	// Escape closes. No Enter-to-save: the message fields need Enter.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !busy) {
				e.preventDefault();
				close();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [busy, close]);

	const backdropProps = useBackdropDismiss(busy ? undefined : close);

	const active = !!saved;
	const config = configFromDraft(draft);
	const armed = isBabysitArmed(config);
	// "Answer" with nothing to say is the one incomplete state. (A blank
	// deny message is valid — it sends the default.)
	const answerMissing =
		draft.question === "answer" && draft.questionMessage.trim().length === 0;
	const dirty =
		JSON.stringify(config) !==
		JSON.stringify(normalizeBabysitConfig(saved ?? null));

	// Prompts already on screen that the rules as drafted would answer the
	// moment they are saved — worth saying before the user commits.
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
			// Main also broadcasts `babysit:changed`; applying the response
			// here too means the badge is right before the modal closes.
			useBabysitStore.getState().apply(sessionId, stored);
			close();
		} catch (err) {
			setError((err as Error).message || "Couldn't update the babysitter");
			setBusy(false);
		}
	};

	const choose = <K extends BabysitRuleKind>(kind: K, value: Draft[K]) => {
		setDraft((d) => ({ ...d, [kind]: value }));
		setJustSwitched(kind);
	};

	const canSubmit = active
		? !busy && dirty && !answerMissing
		: !busy && armed && !answerMissing;

	// One quiet line above the footer; the most consequential fact wins.
	let footnote: { text: string; color: string } | null = null;
	if (waitingCount > 0) {
		footnote = {
			text: `${waitingCount} prompt${waitingCount === 1 ? " is" : "s are"} waiting right now and will be answered as soon as you ${active ? "save" : "start"}.`,
			color: T.warn,
		};
	} else if (active && dirty && !armed && !answerMissing) {
		// The one non-obvious outcome left: Save is acting as Stop.
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
					// Anchored near the top instead of centred: switching a
					// rule reveals a message field, and a centred card would
					// jump as its height changes. This way it only grows down.
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
					{active ? (
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								height: 20,
								padding: "0 8px",
								borderRadius: 10,
								background: T.babysitSoft,
								border: `0.5px solid ${T.babysitBorder}`,
								color: T.babysit,
								fontSize: 11,
								fontWeight: 500,
								flexShrink: 0,
							}}
						>
							<span
								aria-hidden
								style={{
									width: 5,
									height: 5,
									borderRadius: "50%",
									background: T.babysit,
								}}
							/>
							On
						</span>
					) : null}
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 14,
					}}
				>
					<RuleCard
						title="Plan mode"
						armed={draft.plan !== "none"}
						control={
							<Segmented
								label="Plan mode"
								value={draft.plan}
								options={GATE_OPTIONS}
								onChange={(v) => choose("plan", v)}
								disabled={busy}
							/>
						}
					>
						{draft.plan === "deny" ? (
							<MessageField
								ariaLabel="Plan deny message"
								value={draft.planMessage}
								onChange={(planMessage) =>
									setDraft((d) => ({ ...d, planMessage }))
								}
								placeholder="Deny Message (optional)"
								autoFocus={justSwitched === "plan"}
								disabled={busy}
							/>
						) : null}
					</RuleCard>

					<RuleCard
						title="Permission requests"
						armed={draft.permission !== "none"}
						control={
							<Segmented
								label="Permission requests"
								value={draft.permission}
								options={GATE_OPTIONS}
								onChange={(v) => choose("permission", v)}
								disabled={busy}
							/>
						}
					>
						{draft.permission === "deny" ? (
							<MessageField
								ariaLabel="Permission deny message"
								value={draft.permissionMessage}
								onChange={(permissionMessage) =>
									setDraft((d) => ({ ...d, permissionMessage }))
								}
								placeholder="Deny Message (optional)"
								autoFocus={justSwitched === "permission"}
								disabled={busy}
							/>
						) : null}
					</RuleCard>

					<RuleCard
						title="Questions"
						armed={draft.question !== "none"}
						control={
							<Segmented
								label="Questions"
								value={draft.question}
								options={QUESTION_OPTIONS}
								onChange={(v) => choose("question", v)}
								disabled={busy}
							/>
						}
					>
						{draft.question === "answer" ? (
							<MessageField
								ariaLabel="Answer sent to every question"
								value={draft.questionMessage}
								onChange={(questionMessage) =>
									setDraft((d) => ({ ...d, questionMessage }))
								}
								placeholder="I'm not here. Use your best judgement and keep going."
								autoFocus={justSwitched === "question"}
								disabled={busy}
							/>
						) : null}
					</RuleCard>
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
						// Quiet red text rather than `.btn-destructive`: stopping
						// destroys nothing, it just hands the prompts back.
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

/**
 * One prompt type: what it is, the choice of response, and — for the choices
 * that need something said — a message field underneath. The border picks up
 * the babysitter's colour when the rule is armed, so the modal shows at a
 * glance which prompts are being handled.
 */
function RuleCard({
	title,
	armed,
	control,
	children,
}: {
	title: string;
	armed: boolean;
	control: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div
			style={{
				padding: "10px 12px",
				borderRadius: 10,
				background: T.surfaceLow,
				border: `0.5px solid ${armed ? T.babysitBorder : T.border}`,
				transition: "border-color 120ms ease",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
				<div
					style={{
						minWidth: 0,
						flex: 1,
						fontSize: 13,
						fontWeight: 600,
						color: T.text,
					}}
				>
					{title}
				</div>
				{control}
			</div>
			{/* The `babysit-reveal` animation lives on `MessageField` itself,
			    which mounts and unmounts with the choice. */}
			{children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
		</div>
	);
}

/**
 * Message textarea. Same box as `ShortcutForm`'s prompt field, on `T.bg` so
 * it reads as recessed inside the rule card's `surfaceLow`.
 *
 * No visible label: the rule's title plus the chosen segment already say what
 * this is, and the placeholder names it. `ariaLabel` carries that name to
 * screen readers — it is not a `title`, so nothing hovers.
 */
function MessageField({
	ariaLabel,
	value,
	onChange,
	placeholder,
	autoFocus,
	disabled,
}: {
	ariaLabel: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	autoFocus?: boolean;
	disabled?: boolean;
}) {
	return (
		<textarea
			className="babysit-reveal"
			aria-label={ariaLabel}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			autoFocus={autoFocus}
			disabled={disabled}
			rows={2}
			maxLength={BABYSIT_MESSAGE_MAX_LENGTH}
			style={{
				display: "block",
				width: "100%",
				boxSizing: "border-box",
				appearance: "none",
				background: T.bg,
				color: T.text,
				border: `0.5px solid ${T.border}`,
				borderRadius: 6,
				padding: "7px 9px",
				fontSize: 13,
				fontFamily: T.sans,
				lineHeight: 1.45,
				outline: "none",
				resize: "vertical",
				minHeight: 52,
				transition: "border-color 80ms ease",
			}}
			onFocus={(e) => {
				e.currentTarget.style.borderColor = T.babysitBorder;
			}}
			onBlur={(e) => {
				e.currentTarget.style.borderColor = T.border;
			}}
		/>
	);
}

/**
 * Segmented choice. Generic twin of the two-position toggles duplicated in
 * `AttachWorktreeModal` / `ShortcutsMenu` (segmented toggles are kept private
 * per modal in this repo), with one addition: each option names the colour
 * its label takes when selected. Radio semantics, since it picks one value
 * rather than switching a view.
 */
function Segmented<V extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
}: {
	/** Accessible name for the group — the rule's title. */
	label: string;
	value: V;
	options: readonly { value: V; label: string; tone: string }[];
	onChange: (value: V) => void;
	disabled?: boolean;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			style={{
				display: "inline-flex",
				flexShrink: 0,
				background: T.bg,
				border: `0.5px solid ${T.border}`,
				borderRadius: 7,
				padding: 2,
				gap: 2,
			}}
		>
			{options.map((o) => (
				<SegmentedItem
					key={o.value}
					label={o.label}
					tone={o.tone}
					active={o.value === value}
					onClick={() => onChange(o.value)}
					disabled={disabled}
				/>
			))}
		</div>
	);
}

function SegmentedItem({
	label,
	tone,
	active,
	onClick,
	disabled,
}: {
	label: string;
	tone: string;
	active: boolean;
	onClick: () => void;
	disabled?: boolean;
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
			disabled={disabled}
			style={{
				appearance: "none",
				border: "none",
				background: active
					? T.surfaceHi
					: hover
						? T.surface
						: "transparent",
				color: active ? tone : T.textDim,
				fontSize: 11.5,
				fontFamily: "inherit",
				fontWeight: active ? 600 : 500,
				padding: "5px 10px",
				borderRadius: 5,
				whiteSpace: "nowrap",
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
				transition: "background 80ms ease, color 80ms ease",
			}}
		>
			{label}
		</button>
	);
}
