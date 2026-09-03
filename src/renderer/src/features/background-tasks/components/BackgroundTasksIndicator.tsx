import { useEffect, useMemo, useState } from "react";
import { useBackgroundTasksStore } from "../stores/useBackgroundTasksStore";
import { T } from "../../../design/tokens";

/**
 * Ambient, app-global status chip. Renders nothing when there's no background
 * work and nothing failed, so it stays out of the way entirely in the common
 * case.
 *
 * Positioning lives in `components/AmbientStack`, which this renders inside
 * (see `MainApp`) — it used to own the fixed bottom-right corner itself, until
 * the undo toast needed the same space. The stack sits below `.modal-backdrop`
 * so a modal always wins; the reasoning is documented there.
 *
 * NOTE: this repo has a hard no-tooltip rule. Every label here is visibly
 * rendered text; do not add `title` attributes or hover-reveal bubbles.
 */
export function BackgroundTasksIndicator() {
	const tasks = useBackgroundTasksStore((s) => s.tasks);
	const dismiss = useBackgroundTasksStore((s) => s.dismiss);
	const dismissAll = useBackgroundTasksStore((s) => s.dismissAll);
	const [expanded, setExpanded] = useState(false);

	// Derive in the component rather than in a zustand selector — a selector
	// returning a fresh array every call re-renders on unrelated store writes.
	const running = useMemo(
		() => tasks.filter((t) => t.status === "running"),
		[tasks],
	);
	const errors = useMemo(
		() => tasks.filter((t) => t.status === "error"),
		[tasks],
	);

	// Dismissing the last error must not leave an empty card floating.
	useEffect(() => {
		if (errors.length === 0 && expanded) setExpanded(false);
	}, [errors.length, expanded]);

	// Escape collapses the panel — same window-level keydown pattern as
	// ConfirmModal / UpdateModal. No click-outside handler: this panel is
	// non-modal and blocks nothing.
	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setExpanded(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [expanded]);

	if (tasks.length === 0) return null;

	const hasErrors = errors.length > 0;
	const runningLabel =
		running.length === 1
			? running[0].label
			: `${running.length} tasks running`;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 8,
				// AmbientStack disables pointer events on the column so its
				// empty space never swallows clicks; re-enable them here,
				// where there's something real to click.
				pointerEvents: "auto",
			}}
		>
			{expanded && hasErrors ? (
				<div
					role="region"
					aria-label="Failed background tasks"
					style={{
						width: "min(360px, calc(100vw - 40px))",
						maxHeight: 260,
						overflowY: "auto",
						background: T.surface,
						border: `0.5px solid ${T.border}`,
						borderRadius: 10,
						boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
						padding: 10,
						display: "flex",
						flexDirection: "column",
						gap: 8,
					}}
				>
					{errors.map((t) => (
						<div
							key={t.id}
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 4,
								padding: "8px 9px",
								background: T.surfaceLow,
								border: `0.5px solid ${T.borderSoft}`,
								borderRadius: 7,
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "baseline",
									gap: 8,
								}}
							>
								<span
									style={{
										flex: 1,
										fontSize: 12,
										fontWeight: 500,
										color: T.text,
									}}
								>
									{t.label}
								</span>
								<button
									type="button"
									onClick={() => dismiss(t.id)}
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
									Dismiss
								</button>
							</div>
							{/* The main-process "partially failed" error is
							    deliberately multi-line (one line per git step),
							    so preserve the breaks. */}
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
						<button
							type="button"
							onClick={dismissAll}
							style={{
								alignSelf: "flex-end",
								border: "none",
								background: "transparent",
								color: T.textDim,
								fontSize: 11,
								cursor: "pointer",
								padding: "1px 3px",
							}}
						>
							Dismiss all
						</button>
					) : null}
				</div>
			) : null}

			<PillShell
				hasErrors={hasErrors}
				expanded={expanded}
				onToggle={hasErrors ? () => setExpanded((v) => !v) : undefined}
			>
				{running.length > 0 ? (
					<span
						role="status"
						aria-live="polite"
						style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
					>
						<span
							className="asyncy-btn-spinner bg-task-spinner"
							aria-hidden
						/>
						<span>{runningLabel}</span>
					</span>
				) : null}
				{running.length > 0 && hasErrors ? (
					<span aria-hidden style={{ color: T.textFaint }}>·</span>
				) : null}
				{hasErrors ? (
					<span style={{ color: T.danger, fontWeight: 500 }}>
						{errors.length === 1
							? "1 task failed"
							: `${errors.length} tasks failed`}
					</span>
				) : null}
			</PillShell>
		</div>
	);
}

/**
 * The chip itself. Renders as a real `<button>` only when there's something
 * to expand, so a purely-running indicator isn't a fake interactive element.
 */
function PillShell({
	hasErrors,
	expanded,
	onToggle,
	children,
}: {
	hasErrors: boolean;
	expanded: boolean;
	onToggle?: () => void;
	children: React.ReactNode;
}) {
	const style: React.CSSProperties = {
		display: "inline-flex",
		alignItems: "center",
		gap: 7,
		padding: "6px 12px",
		borderRadius: 999,
		fontSize: 12,
		fontFamily: T.sans,
		color: T.textDim,
		background: hasErrors ? T.dangerSoft : T.surface,
		border: `0.5px solid ${hasErrors ? T.dangerBorder : T.border}`,
		boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
		textAlign: "left",
	};

	if (!onToggle) return <div style={style}>{children}</div>;

	// Hover feedback is applied by mutating `currentTarget.style` rather than
	// via a CSS class — inline styles always win on specificity, so a `:hover`
	// rule wouldn't apply. Same workaround as design/Atoms.tsx and
	// design/WorktreeChip.tsx.
	const base = hasErrors ? T.dangerSoft : T.surface;
	const hover = hasErrors ? T.dangerBorder : T.surfaceHi;

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={expanded}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = hover;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = base;
			}}
			style={{ ...style, cursor: "pointer" }}
		>
			{children}
		</button>
	);
}
