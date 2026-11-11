import { useMemo, useState } from "react";
import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { stopSession } from "../lib/sessionControlActions";
import { respondApplyingDeferredModel } from "../lib/modelSwitchActions";
import type {
	AskUserQuestionInput,
	QuestionDef,
} from "../lib/askUserQuestion";
import { T } from "../../../design/tokens";

interface Tone {
	fg: string;
	soft: string;
	border: string;
}

const WARN_TONE: Tone = { fg: T.warn, soft: T.warnSoft, border: T.warnBorder };

const ANSWERED_TONE: Tone = {
	fg: T.text,
	soft: "oklch(0.94 0.005 80 / 0.08)",
	border: "oklch(0.94 0.005 80 / 0.32)",
};


export function AskUserQuestionCard({
	req,
	naked = false,
}: {
	req: PermissionRequest;
	naked?: boolean;
}) {
	const remove = usePermissionsStore((s) => s.remove);
	const input = req.input as unknown as AskUserQuestionInput;
	const questions = input.questions ?? [];
	const isMulti = questions.length > 1;

	const [answers, setAnswers] = useState<Record<string, string[]>>({});
	const [other, setOther] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);

	const allAnswered = useMemo(
		() =>
			questions.every((q) => {
				const arr = answers[q.question] ?? [];
				if (arr.length === 0) return false;
				if (arr.includes("__other__")) {
					return (other[q.question] ?? "").trim().length > 0;
				}
				return true;
			}),
		[questions, answers, other],
	);

	const toggle = (q: QuestionDef, label: string) => {
		setAnswers((prev) => {
			const current = prev[q.question] ?? [];
			if (q.multiSelect) {
				return {
					...prev,
					[q.question]: current.includes(label)
						? current.filter((l) => l !== label)
						: [...current, label],
				};
			}
			return { ...prev, [q.question]: [label] };
		});
	};

	const submit = () => {
		if (submitting || !allAnswered) return;
		setSubmitting(true);
		const formatted: Record<string, string> = {};
		for (const q of questions) {
			const chosen = answers[q.question] ?? [];
			const labels = chosen.map((l) =>
				l === "__other__" ? (other[q.question] ?? "").trim() : l,
			);
			formatted[q.question] = labels.join(", ");
		}
		respondApplyingDeferredModel(req, () =>
			window.claude.respondPermission({
				requestId: req.requestId,
				behavior: "allow",
				updatedInput: {
					...(req.input as Record<string, unknown>),
					answers: formatted,
				},
			}),
		);
		remove(req.requestId);
	};

	const stopAndDeny = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message: "Stopped by user.",
		});
		remove(req.requestId);
		void stopSession(req.sessionId);
	};

	const single = questions.length === 1 ? questions[0] : null;

	return (
		<div
			style={{
				borderRadius: 10,
				background: T.surface,
				border: naked ? "none" : `0.5px solid ${T.warnBorder}`,
				overflow: "hidden",
			}}
		>
			{/* Header */}
			<div
				style={{
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					gap: 10,
					borderBottom: `0.5px solid ${T.borderSoft}`,
				}}
			>
				<QuestionIcon tone={WARN_TONE} />
				<div style={{ fontSize: 12.5, fontWeight: 500, color: T.text }}>
					Claude is asking
				</div>
				{isMulti ? (
					<TagPill tone={WARN_TONE} muted>
						{questions.length} questions
					</TagPill>
				) : single ? (
					<TagPill tone={WARN_TONE}>{single.header}</TagPill>
				) : null}
			</div>

			{/* Body */}
			<div style={{ padding: "16px 16px 4px" }}>
				{single ? (
					<>
						<div
							style={{
								fontSize: 14.5,
								fontWeight: 500,
								color: T.text,
								letterSpacing: "-0.1px",
								marginBottom: 12,
							}}
						>
							{single.question}
						</div>
						<QuestionField
							q={single}
							chosen={answers[single.question] ?? []}
							other={other[single.question] ?? ""}
							onToggle={(label) => toggle(single, label)}
							onOtherChange={(text) =>
								setOther((p) => ({ ...p, [single.question]: text }))
							}
							onSubmit={submit}
						/>
					</>
				) : (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 16,
							paddingBottom: 8,
						}}
					>
						{questions.map((q, i) => (
							<div key={q.question}>
								<div
									style={{
										fontSize: 11,
										fontWeight: 600,
										color: T.warn,
										letterSpacing: 1,
										textTransform: "uppercase",
										marginBottom: 6,
										display: "flex",
										alignItems: "center",
										gap: 8,
									}}
								>
									<span
										style={{
											fontFamily: T.mono,
											color: T.textDim,
											background: T.surfaceLow,
											border: `0.5px solid ${T.border}`,
											padding: "1px 6px",
											borderRadius: 4,
										}}
									>
										{i + 1}
									</span>
									<span
										style={{
											color: T.text,
											textTransform: "none",
											letterSpacing: 0,
											fontSize: 13,
											fontWeight: 500,
										}}
									>
										{q.question}
									</span>
								</div>
								<QuestionField
									q={q}
									chosen={answers[q.question] ?? []}
									other={other[q.question] ?? ""}
									onToggle={(label) => toggle(q, label)}
									onOtherChange={(text) =>
										setOther((p) => ({ ...p, [q.question]: text }))
									}
									onSubmit={submit}
								/>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Footer */}
			<div
				style={{
					padding: "10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "flex-end",
					gap: 8,
				}}
			>
				<button className="btn" onClick={stopAndDeny} disabled={submitting}>
					Stop
				</button>
				<button
					className="btn btn-warn"
					onClick={submit}
					disabled={!allAnswered || submitting}
				>
					{submitting ? "…" : "Submit"}
				</button>
			</div>
		</div>
	);
}

function splitAnswer(q: QuestionDef, answer: string) {
	const labels = q.options.map((o) => o.label);
	if (labels.includes(answer)) return { chosen: [answer], other: "" };
	const parts = q.multiSelect ? answer.split(", ") : [answer];
	const chosen = parts.filter((p) => labels.includes(p));
	const other = parts
		.filter((p) => !labels.includes(p))
		.join(", ")
		.trim();
	return { chosen, other };
}

export function AnsweredQuestionCard({
	questions,
	answers,
}: {
	questions: QuestionDef[];
	answers: Record<string, string>;
}) {
	const single = questions.length === 1 ? questions[0] : null;
	return (
		<div
			style={{
				maxWidth: 760,
				margin: "0 auto 22px",
				borderRadius: 10,
				background: T.surface,
				border: `0.5px solid ${ANSWERED_TONE.border}`,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					gap: 10,
					borderBottom: `0.5px solid ${T.borderSoft}`,
				}}
			>
				<QuestionIcon tone={ANSWERED_TONE} />
				<div style={{ fontSize: 12.5, fontWeight: 500, color: T.text }}>
					Claude asked
				</div>
				{single ? (
					<TagPill tone={ANSWERED_TONE}>{single.header}</TagPill>
				) : (
					<TagPill tone={ANSWERED_TONE} muted>
						{questions.length} questions
					</TagPill>
				)}
				<span style={{ flex: 1 }} />
				<span style={{ fontSize: 11.5, color: T.textMute }}>Answered</span>
			</div>
			<div
				style={{
					padding: "16px 16px 8px",
					display: "flex",
					flexDirection: "column",
					gap: 16,
				}}
			>
				{questions.map((q, i) => (
					<AnsweredQuestion
						key={q.question}
						q={q}
						index={single ? null : i + 1}
						answer={answers[q.question] ?? ""}
					/>
				))}
			</div>
		</div>
	);
}

function AnsweredQuestion({
	q,
	index,
	answer,
}: {
	q: QuestionDef;
	index: number | null;
	answer: string;
}) {
	const { chosen, other } = splitAnswer(q, answer);
	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 10,
				}}
			>
				{index !== null ? (
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							fontFamily: T.mono,
							color: T.textDim,
							background: T.surfaceLow,
							border: `0.5px solid ${T.border}`,
							padding: "1px 6px",
							borderRadius: 4,
						}}
					>
						{index}
					</span>
				) : null}
				<span
					style={{
						fontSize: index !== null ? 13 : 14.5,
						fontWeight: 500,
						color: T.text,
						letterSpacing: index !== null ? 0 : "-0.1px",
					}}
				>
					{q.question}
				</span>
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 8,
					paddingBottom: 8,
				}}
			>
				{q.options.map((opt) => (
					<InlineOption
						key={opt.label}
						tone={ANSWERED_TONE}
						title={opt.label}
						desc={opt.description}
						preview={opt.preview}
						selected={chosen.includes(opt.label)}
					/>
				))}
				{other ? (
					<InlineOption
						tone={ANSWERED_TONE}
						title={other}
						desc="Your own answer"
						selected
					/>
				) : null}
			</div>
		</div>
	);
}

function QuestionField({
	q,
	chosen,
	other,
	onToggle,
	onOtherChange,
	onSubmit,
}: {
	q: QuestionDef;
	chosen: string[];
	other: string;
	onToggle: (label: string) => void;
	onOtherChange: (text: string) => void;
	onSubmit: () => void;
}) {
	return (
		<div style={{ paddingBottom: 8 }}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{q.options.map((opt) => (
					<InlineOption
						key={opt.label}
						tone={WARN_TONE}
						title={opt.label}
						desc={opt.description}
						preview={opt.preview}
						selected={chosen.includes(opt.label)}
						onPick={() => onToggle(opt.label)}
					/>
				))}
				<InlineOption
					tone={WARN_TONE}
					title="Other…"
					desc="Type your own answer below."
					selected={chosen.includes("__other__")}
					onPick={() => onToggle("__other__")}
				/>
			</div>
			{chosen.includes("__other__") ? (
				<div
					style={{
						marginTop: 10,
						padding: "10px 12px",
						borderRadius: 8,
						background: T.warnSoft,
						border: `0.5px solid ${T.warnBorder}`,
						display: "flex",
						alignItems: "flex-start",
						gap: 10,
					}}
				>
					<span
						style={{
							fontSize: 10.5,
							fontWeight: 600,
							color: T.warn,
							letterSpacing: 1,
							textTransform: "uppercase",
							marginTop: 6,
						}}
					>
						Other
					</span>
					<textarea
						autoFocus
						value={other}
						onChange={(e) => onOtherChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key !== "Enter") return;

							// Plain Enter → submit
							if (
								!e.shiftKey &&
								!e.metaKey &&
								!e.ctrlKey &&
								!e.altKey
							) {
								e.preventDefault();
								onSubmit();
								return;
							}

							// Cmd+Enter → insert newline at cursor (not native on macOS)
							if (
								e.metaKey &&
								!e.shiftKey &&
								!e.ctrlKey &&
								!e.altKey
							) {
								e.preventDefault();
								const ta = e.currentTarget;
								const start = ta.selectionStart ?? other.length;
								const end = ta.selectionEnd ?? other.length;
								const next =
									other.slice(0, start) + "\n" + other.slice(end);
								onOtherChange(next);
								requestAnimationFrame(() => {
									ta.selectionStart = ta.selectionEnd = start + 1;
								});
								return;
							}

							// Shift+Enter and anything else: let the browser handle it.
						}}
						rows={2}
						placeholder="Type your answer…"
						style={{
							flex: 1,
							resize: "none",
							background: "transparent",
							border: "none",
							outline: "none",
							color: T.text,
							fontFamily: T.sans,
							fontSize: 13,
							lineHeight: 1.5,
							padding: "4px 0",
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

function InlineOption({
	tone,
	title,
	desc,
	preview,
	selected,
	onPick,
}: {
	tone: Tone;
	title: string;
	desc: string;
	preview?: string;
	selected: boolean;
	onPick?: () => void;
}) {
	return (
		<div
			onClick={onPick}
			style={{
				padding: "10px 12px",
				borderRadius: 8,
				background: selected ? tone.soft : T.surfaceLow,
				border: `0.5px solid ${selected ? tone.border : T.border}`,
				cursor: onPick ? "pointer" : "default",
				opacity: onPick || selected ? 1 : 0.6,
				display: "flex",
				alignItems: "flex-start",
				gap: 10,
			}}
		>
			<div
				style={{
					width: 14,
					height: 14,
					borderRadius: "50%",
					marginTop: 2,
					flexShrink: 0,
					border: `1.5px solid ${selected ? tone.fg : T.border}`,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{selected ? (
					<div
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: tone.fg,
						}}
					/>
				) : null}
			</div>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div
					style={{
						fontSize: 12.5,
						fontWeight: 500,
						color: T.text,
						marginBottom: 2,
					}}
				>
					{title}
				</div>
				<div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.4 }}>
					{desc}
				</div>
				{selected && preview ? (
					<pre
						style={{
							marginTop: 6,
							marginBottom: 0,
							fontSize: 11,
							padding: 8,
							background: T.surfaceLow,
							borderRadius: 4,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							fontFamily: T.mono,
							color: T.textDim,
						}}
					>
						{preview}
					</pre>
				) : null}
			</div>
		</div>
	);
}

function QuestionIcon({ tone }: { tone: Tone }) {
	return (
		<div
			style={{
				width: 22,
				height: 22,
				borderRadius: 6,
				background: tone.soft,
				border: `0.5px solid ${tone.border}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: tone.fg,
				fontFamily: T.mono,
				fontSize: 12,
				fontWeight: 700,
			}}
		>
			?
		</div>
	);
}

function TagPill({
	tone,
	children,
	muted,
}: {
	tone: Tone;
	children: React.ReactNode;
	muted?: boolean;
}) {
	return (
		<span
			style={{
				fontSize: 10.5,
				fontWeight: 600,
				color: muted ? T.textDim : tone.fg,
				letterSpacing: muted ? 0.6 : 1.2,
				textTransform: "uppercase",
				padding: "3px 7px",
				borderRadius: 4,
				background: muted ? T.surfaceLow : tone.soft,
				border: `0.5px solid ${muted ? T.border : tone.border}`,
			}}
		>
			{children}
		</span>
	);
}
