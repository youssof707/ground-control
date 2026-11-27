import { useEffect, useMemo, useState } from "react";
import { useBackgroundTasksStore } from "../stores/useBackgroundTasksStore";
import { T } from "../../../design/tokens";

export function BackgroundTasksIndicator() {
	const tasks = useBackgroundTasksStore((s) => s.tasks);
	const dismiss = useBackgroundTasksStore((s) => s.dismiss);
	const dismissAll = useBackgroundTasksStore((s) => s.dismissAll);
	const [expanded, setExpanded] = useState(false);

	const running = useMemo(
		() => tasks.filter((t) => t.status === "running"),
		[tasks],
	);
	const errors = useMemo(
		() => tasks.filter((t) => t.status === "error"),
		[tasks],
	);

	useEffect(() => {
		if (errors.length === 0 && expanded) setExpanded(false);
	}, [errors.length, expanded]);

	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setExpanded(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [expanded]);

	if (tasks.length === 0) return null;

	const statusLabel = running.map((t) => t.label).join(", ");

	return (
		<div
			className="bg-task-indicator"
			style={{
				flex: 1,
				minWidth: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				gap: 7,
			}}
		>
			{expanded && errors.length > 0 ? (
				<FailedTasksPanel
					errors={errors}
					onDismiss={dismiss}
					onDismissAll={dismissAll}
				/>
			) : null}

			{errors.length > 0 ? (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
					aria-label={
						errors.length === 1
							? "1 background task failed"
							: `${errors.length} background tasks failed`
					}
					className="bg-task-failed"
					style={{
						flexShrink: 0,
						border: "none",
						background: "transparent",
						padding: 0,
						fontSize: 10,
						fontFamily: T.mono,
						letterSpacing: 0.2,
						color: T.danger,
						cursor: "pointer",
					}}
				>
					{errors.length === 1 ? "1 failed" : `${errors.length} failed`}
				</button>
			) : null}

			{running.length > 0 ? (
				<span
					role="status"
					aria-live="polite"
					aria-label={statusLabel}
					style={{ flexShrink: 0, display: "inline-flex" }}
				>
					<span className="asyncy-btn-spinner bg-task-spinner" aria-hidden />
				</span>
			) : null}
		</div>
	);
}

function FailedTasksPanel({
	errors,
	onDismiss,
	onDismissAll,
}: {
	errors: { id: string; label: string; error: string | null }[];
	onDismiss: (id: string) => void;
	onDismissAll: () => void;
}) {
	return (
		<div
			role="region"
			aria-label="Failed background tasks"
			style={{
				position: "absolute",
				left: 0,
				right: 0,
				bottom: "calc(100% + 8px)",
				maxHeight: 260,
				overflowY: "auto",
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				borderRadius: 10,
				boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
				padding: 8,
				display: "flex",
				flexDirection: "column",
				gap: 6,
				userSelect: "text",
			}}
		>
			{errors.map((t) => (
				<div
					key={t.id}
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 4,
						padding: "7px 8px",
						background: T.surfaceLow,
						border: `0.5px solid ${T.borderSoft}`,
						borderRadius: 7,
					}}
				>
					<div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
						<span
							style={{
								flex: 1,
								minWidth: 0,
								fontSize: 12,
								fontWeight: 500,
								color: T.text,
								wordBreak: "break-word",
							}}
						>
							{t.label}
						</span>
						<TextButton onClick={() => onDismiss(t.id)}>Dismiss</TextButton>
					</div>
					<span
						style={{
							fontSize: 11,
							lineHeight: 1.45,
							color: T.textMute,
							fontFamily: T.mono,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
						}}
					>
						{t.error}
					</span>
				</div>
			))}
			{errors.length > 1 ? (
				<div style={{ alignSelf: "flex-end" }}>
					<TextButton onClick={onDismissAll}>Dismiss all</TextButton>
				</div>
			) : null}
		</div>
	);
}

function TextButton({
	onClick,
	children,
}: {
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="bg-task-text-btn"
			style={{
				flexShrink: 0,
				border: "none",
				background: "transparent",
				color: T.textMute,
				fontSize: 11,
				cursor: "pointer",
				padding: "1px 3px",
			}}
		>
			{children}
		</button>
	);
}
