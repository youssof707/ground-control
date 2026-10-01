import { useEffect, useRef, useState } from "react";
import { T } from "../../../design/tokens";
import { useLiveTasksStore } from "../stores/useLiveTasksStore";
import { stopBackgroundTask } from "../lib/sessionControlActions";

/**
 * The floating "N background tasks" chip, shown next to `ActivityChip` in
 * the overlay above the composer (SessionChat + SidequestPanel). It surfaces
 * the CLI's own background work — dev servers, background shells, subagents
 * — which since the shells-don't-pin-running fix is otherwise invisible: a
 * session can read idle while `npm start` is still alive inside it.
 *
 * Clicking expands a card (upward, so it never covers the composer) listing
 * each task with a Stop button. Stop kills just that task via the SDK's
 * `stopTask`; the row disappears only when the CLI confirms with
 * `task_notification{stopped}` → a fresh `tasks` broadcast — the `stopping`
 * flag covers the round-trip with a spinner.
 *
 * No tooltips, per repo rule: the full task description is always visible
 * text in the card, wrapped rather than truncated.
 */
export function BackgroundTasksChip({ sessionId }: { sessionId: string }) {
	const tasks = useLiveTasksStore((s) => s.tasks[sessionId]);
	const stopping = useLiveTasksStore((s) => s.stopping);
	const [expanded, setExpanded] = useState(false);
	const [hover, setHover] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	const count = tasks?.length ?? 0;

	// Collapse when the last task dies (or the session changes) so the card
	// doesn't pop back open by itself the next time a task starts.
	useEffect(() => {
		if (count === 0) setExpanded(false);
	}, [count, sessionId]);

	// Per-second tick for the elapsed labels — only while the card is open,
	// and only this component re-renders (same reasoning as ActivityChip).
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!expanded) return;
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [expanded]);

	// Dismissal: Escape, mousedown outside, scroll or resize — the same
	// trio RowMenuButton uses, so every small panel in the app closes the
	// same way. Scroll uses capture so the transcript scroller triggers it.
	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setExpanded(false);
		};
		const onDown = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setExpanded(false);
		};
		const onScroll = () => setExpanded(false);
		window.addEventListener("keydown", onKey);
		window.addEventListener("mousedown", onDown);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [expanded]);

	if (!tasks || count === 0) return null;

	const color = hover || expanded ? "oklch(0.45 0.008 70)" : "oklch(0.55 0.008 70)";
	const border =
		hover || expanded
			? "oklch(0.45 0.008 70 / 0.75)"
			: "oklch(0.55 0.008 70 / 0.55)";

	return (
		<div ref={rootRef} style={{ position: "relative" }}>
			{expanded ? (
				<div
					role="region"
					aria-label="Background tasks"
					style={{
						position: "absolute",
						bottom: "calc(100% + 6px)",
						right: 0,
						zIndex: 50,
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
					{tasks.map((t) => (
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
								{/* Wrapped, never truncated: with tooltips banned
								    this text is the whole affordance. */}
								<span
									style={{
										flex: 1,
										fontSize: 12,
										fontWeight: 500,
										color: T.text,
										lineHeight: 1.4,
										wordBreak: "break-word",
									}}
								>
									{t.description || "Background task"}
								</span>
								{stopping[t.id] ? (
									<span
										aria-hidden
										className="asyncy-btn-spinner bg-task-spinner"
										style={{ flexShrink: 0 }}
									/>
								) : (
									<button
										type="button"
										onClick={() =>
											void stopBackgroundTask(sessionId, t.id)
										}
										onMouseEnter={(e) => {
											e.currentTarget.style.textDecoration =
												"underline";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.textDecoration =
												"none";
										}}
										style={{
											flexShrink: 0,
											border: "none",
											background: "transparent",
											color: T.danger,
											fontSize: 11,
											fontWeight: 500,
											cursor: "pointer",
											padding: "1px 3px",
										}}
									>
										Stop
									</button>
								)}
							</div>
							<span
								style={{
									fontSize: 11,
									color: T.textMute,
									fontFamily: T.mono,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{kindLabel(t.type)}
								{t.startedAt > 0
									? ` · ${formatElapsed(
										Math.floor(
											(Date.now() - t.startedAt) / 1000,
										),
									)}`
									: ""}
							</span>
						</div>
					))}
				</div>
			) : null}

			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				onMouseEnter={() => setHover(true)}
				onMouseLeave={() => setHover(false)}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					height: 22,
					padding: "0 9px",
					borderRadius: 11,
					background: T.surface,
					border: `0.5px solid ${border}`,
					color,
					fontSize: 11.5,
					fontFamily: T.mono,
					fontVariantNumeric: "tabular-nums",
					userSelect: "none",
					lineHeight: 1,
					cursor: "pointer",
				}}
			>
				{/* No spinner: the count IS the signal, and a permanently
				    spinning ring next to a dev server that may sit there for
				    hours is just noise. */}
				{count === 1 ? "1 background task" : `${count} background tasks`}
			</button>
		</div>
	);
}

/**
 * Sidebar variant: an inert pill reading "⟳ 2 tasks", shown in a session row
 * *in place of* the "idle" status pill. An idle session with a dev server
 * still running inside it is the exact case the running/idle split created,
 * and "idle" alone actively hides it.
 *
 * Deliberately not interactive: the row is wrapped in a `<Link>`, and a
 * popover inside a virtual-scrolling list would have to fight both the
 * navigation and the scroll-to-dismiss. Click the row, kill from the chip
 * above the composer.
 *
 * Matches `StatusPill`'s inert geometry exactly (height 22 / radius 11 /
 * 0.5px border / 11.5px / weight 500) so it drops into the chips row without
 * shifting anything.
 */
export function BackgroundTasksPill({ sessionId }: { sessionId: string }) {
	// Primitive selector: the row re-renders only when the COUNT changes, not
	// on every task-list broadcast — these rows are on the streaming path.
	const count = useLiveTasksStore((s) => s.tasks[sessionId]?.length ?? 0);
	if (count === 0) return null;
	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: "transparent",
				border: `0.5px solid ${T.border}`,
				fontSize: 11.5,
				color: T.textDim,
				fontWeight: 500,
				letterSpacing: "0.1px",
				whiteSpace: "nowrap",
			}}
		>
			{count === 1 ? "1 task" : `${count} tasks`}
		</div>
	);
}

/** Human word for a CLI `task_type`. Unknown types show as "task". */
function kindLabel(type: string | undefined): string {
	if (!type) return "task";
	if (/bash|shell/i.test(type)) return "shell";
	if (/agent/i.test(type)) return "agent";
	if (/workflow/i.test(type)) return "workflow";
	return "task";
}

function formatElapsed(sec: number): string {
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
