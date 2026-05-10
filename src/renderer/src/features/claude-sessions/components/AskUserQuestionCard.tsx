import { useMemo, useState } from "react";
import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";

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

	return (
		<div
			style={{
				border: "2px solid #f5a623",
				borderRadius: 10,
				padding: 14,
				margin: "8px 0",
				background: "#fff8e6",
				display: "flex",
				flexDirection: "column",
				gap: 14,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ fontSize: 16 }}>❓</span>
				<div style={{ fontSize: 13, fontWeight: 600 }}>
					Claude is asking{questions.length > 1 ? ` ${questions.length} questions` : ""}
				</div>
			</div>

			{questions.map((q) => {
				const chosen = answers[q.question] ?? [];
				return (
					<div
						key={q.question}
						style={{
							background: "#fff",
							border: "1px solid #f0d68b",
							borderRadius: 8,
							padding: 12,
							display: "flex",
							flexDirection: "column",
							gap: 10,
						}}
					>
						<div>
							<div
								style={{
									display: "inline-block",
									fontSize: 10,
									fontWeight: 600,
									letterSpacing: "0.04em",
									textTransform: "uppercase",
									color: "#9a6700",
									background: "#fff8c5",
									padding: "2px 6px",
									borderRadius: 4,
									marginBottom: 6,
								}}
							>
								{q.header}
							</div>
							<div style={{ fontSize: 14, fontWeight: 500 }}>{q.question}</div>
							{q.multiSelect ? (
								<div
									style={{ fontSize: 11, color: "#86868b", marginTop: 2 }}
								>
									Select one or more
								</div>
							) : null}
						</div>

						<div
							style={{ display: "flex", flexDirection: "column", gap: 6 }}
						>
							{q.options.map((opt) => {
								const selected = chosen.includes(opt.label);
								return (
									<OptionButton
										key={opt.label}
										selected={selected}
										onClick={() => toggle(q, opt.label)}
									>
										<div style={{ fontWeight: 600, fontSize: 13 }}>
											{opt.label}
										</div>
										<div
											style={{
												fontSize: 12,
												color: "#515154",
												marginTop: 2,
											}}
										>
											{opt.description}
										</div>
										{selected && opt.preview ? (
											<pre
												style={{
													marginTop: 6,
													fontSize: 11,
													padding: 8,
													background: "#f5f5f7",
													borderRadius: 4,
													whiteSpace: "pre-wrap",
													wordBreak: "break-word",
													fontFamily:
														"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
												}}
											>
												{opt.preview}
											</pre>
										) : null}
									</OptionButton>
								);
							})}
							<OptionButton
								selected={chosen.includes("__other__")}
								onClick={() => toggle(q, "__other__")}
							>
								<div style={{ fontWeight: 600, fontSize: 13 }}>Other…</div>
							</OptionButton>
							{chosen.includes("__other__") ? (
								<input
									autoFocus
									value={other[q.question] ?? ""}
									onChange={(e) =>
										setOther((p) => ({
											...p,
											[q.question]: e.target.value,
										}))
									}
									placeholder="Type your answer…"
									style={{
										fontSize: 13,
										padding: "6px 10px",
										border: "1px solid #d2d2d7",
										borderRadius: 6,
										marginTop: 4,
									}}
								/>
							) : null}
						</div>
					</div>
				);
			})}

			<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
				<button onClick={skip} className="btn" style={{ fontSize: 13 }}>
					Skip
				</button>
				<button
					onClick={submit}
					disabled={!allAnswered || submitting}
					className="btn"
					style={{
						fontSize: 13,
						background: allAnswered ? "#1d1d1f" : "#d2d2d7",
						color: "#fff",
						borderColor: allAnswered ? "#1d1d1f" : "#d2d2d7",
					}}
				>
					Submit
				</button>
			</div>
		</div>
	);
}

function OptionButton({
	selected,
	onClick,
	children,
}: {
	selected: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				textAlign: "left",
				padding: "8px 12px",
				borderRadius: 6,
				border: `1.5px solid ${selected ? "#1d1d1f" : "#e5e5ea"}`,
				background: selected ? "#f0f0f2" : "#fff",
				cursor: "pointer",
				font: "inherit",
				color: "inherit",
			}}
		>
			{children}
		</button>
	);
}
