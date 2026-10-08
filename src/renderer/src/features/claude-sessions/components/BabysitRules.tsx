import { useState } from "react";
import {
	BABYSIT_MESSAGE_MAX_LENGTH,
	normalizeBabysitConfig,
	type BabysitConfig,
	type BabysitRuleKind,
} from "@shared/claude-sessions/babysit";
import { T } from "../../../design/tokens";

type GateChoice = "none" | "approve" | "deny";
type QuestionChoice = "none" | "answer";

export interface BabysitDraft {
	plan: GateChoice;
	planMessage: string;
	permission: GateChoice;
	permissionMessage: string;
	question: QuestionChoice;
	questionMessage: string;
}

export function draftFromConfig(
	config: BabysitConfig | undefined,
): BabysitDraft {
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

export function configFromDraft(draft: BabysitDraft): BabysitConfig {
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

const GATE_OPTIONS = [
	{ value: "none", label: "Do nothing", tone: T.text },
	{ value: "approve", label: "Approve", tone: T.ok },
	{ value: "deny", label: "Deny", tone: T.danger },
] as const;

const QUESTION_OPTIONS = [
	{ value: "none", label: "Do nothing", tone: T.text },
	{ value: "answer", label: "Answer", tone: T.babysit },
] as const;

export function BabysitRuleCards({
	draft,
	onChange,
	disabled,
}: {
	draft: BabysitDraft;
	onChange: (update: (draft: BabysitDraft) => BabysitDraft) => void;
	disabled?: boolean;
}) {
	const [justSwitched, setJustSwitched] = useState<BabysitRuleKind | null>(
		null,
	);

	const choose = <K extends BabysitRuleKind>(kind: K, value: BabysitDraft[K]) => {
		onChange((d) => ({ ...d, [kind]: value }));
		setJustSwitched(kind);
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<RuleCard
				title="Plan mode"
				armed={draft.plan !== "none"}
				control={
					<Segmented
						label="Plan mode"
						value={draft.plan}
						options={GATE_OPTIONS}
						onChange={(v) => choose("plan", v)}
						disabled={disabled}
					/>
				}
			>
				{draft.plan === "deny" ? (
					<MessageField
						ariaLabel="Plan deny message"
						value={draft.planMessage}
						onChange={(planMessage) => onChange((d) => ({ ...d, planMessage }))}
						placeholder="Deny Message (optional)"
						autoFocus={justSwitched === "plan"}
						disabled={disabled}
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
						disabled={disabled}
					/>
				}
			>
				{draft.permission === "deny" ? (
					<MessageField
						ariaLabel="Permission deny message"
						value={draft.permissionMessage}
						onChange={(permissionMessage) =>
							onChange((d) => ({ ...d, permissionMessage }))
						}
						placeholder="Deny Message (optional)"
						autoFocus={justSwitched === "permission"}
						disabled={disabled}
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
						disabled={disabled}
					/>
				}
			>
				{draft.question === "answer" ? (
					<MessageField
						ariaLabel="Answer sent to every question"
						value={draft.questionMessage}
						onChange={(questionMessage) =>
							onChange((d) => ({ ...d, questionMessage }))
						}
						placeholder="I'm not here. Use your best judgement and keep going."
						autoFocus={justSwitched === "question"}
						disabled={disabled}
					/>
				) : null}
			</RuleCard>
		</div>
	);
}

export function BabysitOnPill({ label }: { label: string }) {
	return (
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
				whiteSpace: "nowrap",
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
			{label}
		</span>
	);
}

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
			{children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
		</div>
	);
}

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

function Segmented<V extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
}: {
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
