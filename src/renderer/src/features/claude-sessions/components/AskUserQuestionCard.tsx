import { useMemo, useState } from "react";
import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { T } from "../../../design/tokens";

interface OptionDef {
	label: string;
	description: string;
	preview?: string;
}

interface QuestionDef {
	question: string;
	header: string;
	options: OptionDef[];
	multiSelect?: boolean;
}

interface AskUserQuestionInput {
	questions: QuestionDef[];
}

export function AskUserQuestionCard({ req }: { req: PermissionRequest }) {
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
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "allow",
			updatedInput: {
				...(req.input as Record<string, unknown>),
				answers: formatted,
			},
		});
		remove(req.requestId);
	};

	const skip = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message: "User skipped the question.",
		});
		remove(req.requestId);
	};

	const single = questions.length === 1 ? questions[0] : null;

	return (
		<div
			style={{
				borderRadius: 10,
				background: T.surface,
				border: `0.5px solid ${T.accentBorder}`,
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
				<QuestionIcon />
				<div style={{ fontSize: 12.5, fontWeight: 500, color: T.text }}>
					Claude is asking
				</div>
				{isMulti ? (
					<TagPill muted>{questions.length} questions</TagPill>
				) : single ? (
					<TagPill>{single.header}</TagPill>
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
										color: T.accent,
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
				<button className="btn" onClick={skip} disabled={submitting}>
					Skip
				</button>
				<button
					className="btn btn-primary"
					onClick={submit}
					disabled={!allAnswered || submitting}
				>
					{submitting ? "…" : "Submit"}
				</button>
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
}: {
	q: QuestionDef;
	chosen: string[];
	other: string;
	onToggle: (label: string) => void;
	onOtherChange: (text: string) => void;
}) {
	const cols = q.options.length >= 4 ? 4 : 3;
	return (
		<div style={{ paddingBottom: 8 }}>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: `repeat(${cols}, 1fr)`,
					gap: 8,
				}}
			>
				{q.options.map((opt) => (
					<InlineOption
						key={opt.label}
						title={opt.label}
						desc={opt.description}
						preview={opt.preview}
						selected={chosen.includes(opt.label)}
						onPick={() => onToggle(opt.label)}
					/>
				))}
				<InlineOption
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
						background: T.accentSoft,
						border: `0.5px solid ${T.accentBorder}`,
						display: "flex",
						alignItems: "flex-start",
						gap: 10,
					}}
				>
					<span
						style={{
							fontSize: 10.5,
							fontWeight: 600,
							color: T.accent,
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
	title,
	desc,
	preview,
	selected,
	onPick,
}: {
	title: string;
	desc: string;
	preview?: string;
	selected: boolean;
	onPick: () => void;
}) {
	return (
		<div
			onClick={onPick}
			style={{
				padding: "10px 12px",
				borderRadius: 8,
				background: selected ? T.accentSoft : T.surfaceLow,
				border: `0.5px solid ${selected ? T.accentBorder : T.border}`,
				cursor: "pointer",
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
					border: `1.5px solid ${selected ? T.accent : T.border}`,
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
							background: T.accent,
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

function QuestionIcon() {
	return (
		<div
			style={{
				width: 22,
				height: 22,
				borderRadius: 6,
				background: T.accentSoft,
				border: `0.5px solid ${T.accentBorder}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: T.accent,
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
	children,
	muted,
}: {
	children: React.ReactNode;
	muted?: boolean;
}) {
	return (
		<span
			style={{
				fontSize: 10.5,
				fontWeight: 600,
				color: muted ? T.textDim : T.accent,
				letterSpacing: muted ? 0.6 : 1.2,
				textTransform: "uppercase",
				padding: "3px 7px",
				borderRadius: 4,
				background: muted ? T.surfaceLow : T.accentSoft,
				border: `0.5px solid ${muted ? T.border : T.accentBorder}`,
			}}
		>
			{children}
		</span>
	);
}
