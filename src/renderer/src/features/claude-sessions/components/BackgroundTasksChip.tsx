import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
	const [expanded, setExpanded] = useState(false);
	const [hover, setHover] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);
	// Card may grow upward almost to the top of the window, so it rarely
	// needs to scroll. Measured on open, before paint; resize closes the
	// card, so one measurement per open is enough.
	const [maxCardHeight, setMaxCardHeight] = useState(260);
	useLayoutEffect(() => {
		if (!expanded || !rootRef.current) return;
		const top = rootRef.current.getBoundingClientRect().top;
		setMaxCardHeight(Math.max(120, Math.floor(top - 6 - 16)));
	}, [expanded]);

	const count = tasks?.length ?? 0;

	// Collapse when the last task dies (or the session changes) so the card
	// doesn't pop back open by itself the next time a task starts.
	useEffect(() => {
		if (count === 0) setExpanded(false);
	}, [count, sessionId]);

	// Dismissal: Escape, mousedown outside, scroll or resize — the same
	// trio RowMenuButton uses, so every small panel in the app closes the
	// same way. Scroll uses capture so the transcript scroller triggers it —
	// except scrolling the card itself, which must not dismiss it.
	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setExpanded(false);
		};
		const onDown = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setExpanded(false);
		};
		const onScroll = (e: Event) => {
			const target = e.target;
			if (target instanceof Node && cardRef.current?.contains(target)) return;
			setExpanded(false);
		};
		const onResize = () => setExpanded(false);
		window.addEventListener("keydown", onKey);
		window.addEventListener("mousedown", onDown);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
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
				<BackgroundTasksCard
					sessionId={sessionId}
					cardRef={cardRef}
					style={{
						position: "absolute",
						bottom: "calc(100% + 6px)",
						right: 0,
						maxHeight: maxCardHeight,
					}}
				/>
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
 * The task list card shared by the composer chip and the sidebar pill: one
 * row per task with its full description, kind + elapsed, and a Stop button.
 * Owns the per-second elapsed tick, so it only runs while a card is mounted
 * and only the card re-renders (same reasoning as ActivityChip). Callers own
 * positioning via `style`.
 */
function BackgroundTasksCard({
	sessionId,
	cardRef,
	style,
}: {
	sessionId: string;
	cardRef: React.RefObject<HTMLDivElement | null>;
	style: React.CSSProperties;
}) {
	const tasks = useLiveTasksStore((s) => s.tasks[sessionId]);
	const stopping = useLiveTasksStore((s) => s.stopping);
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, []);
	if (!tasks || tasks.length === 0) return null;
	return (
		<div
			ref={cardRef}
			role="region"
			aria-label="Background tasks"
			style={{
				zIndex: 50,
				width: "min(360px, calc(100vw - 40px))",
				overflowY: "auto",
				overscrollBehavior: "contain",
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				borderRadius: 10,
				boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
				padding: 10,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				...style,
			}}
		>
			{tasks.map((t) => (
				<div
					key={t.id}
					style={{
						display: "flex",
						flexDirection: "column",
						flexShrink: 0,
						gap: 4,
						padding: "8px 9px",
						background: T.surfaceLow,
						border: `0.5px solid ${T.borderSoft}`,
						borderRadius: 7,
					}}
				>
					<div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
						{/* Wrapped, never truncated: with tooltips banned this
						    text is the whole affordance. */}
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
								onClick={() => void stopBackgroundTask(sessionId, t.id)}
								onMouseEnter={(e) => {
									e.currentTarget.style.textDecoration = "underline";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.textDecoration = "none";
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
							? ` · ${formatElapsed(Math.floor((Date.now() - t.startedAt) / 1000))}`
							: ""}
					</span>
				</div>
			))}
		</div>
	);
}

const SIDEBAR_CARD_WIDTH = 360;
const SIDEBAR_CARD_GAP = 6;
const SIDEBAR_CARD_MARGIN = 8;

/**
 * Sidebar variant: a pill reading "• 2 tasks" (white dot + white text on a
 * translucent white fill), shown in a session row *in place of* the "idle"
 * status pill. An idle session with a dev server still running inside it is
 * the exact case the running/idle split created, and "idle" alone actively
 * hides it.
 *
 * Clicking opens the same task card as the composer chip, so a task can be
 * killed without opening the session. The card is portalled to <body> and
 * `position: fixed` — the sidebar clips and virtual-scrolls, and an
 * in-flow popover would be cut off by both. It opens below the pill, or
 * above when there isn't room. Dismissal matches the chip (Escape, outside
 * mousedown, scroll outside the card, resize).
 *
 * The row is a `<Link>`: the pill swallows its own clicks, and the card
 * swallows clicks too because React bubbles synthetic events through
 * portals to the Link, which would otherwise navigate on every Stop.
 *
 * Matches `StatusPill`'s geometry (height 22 / radius 11 / 0.5px border /
 * 11.5px / weight 500) so it drops into the chips row without shifting.
 */
export function BackgroundTasksPill({ sessionId }: { sessionId: string }) {
	// Primitive selector: the row re-renders only when the COUNT changes, not
	// on every task-list broadcast — these rows are on the streaming path.
	const count = useLiveTasksStore((s) => s.tasks[sessionId]?.length ?? 0);
	const [open, setOpen] = useState(false);
	const [hover, setHover] = useState(false);
	const [pos, setPos] = useState<React.CSSProperties | null>(null);
	const pillRef = useRef<HTMLButtonElement | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (count === 0) setOpen(false);
	}, [count]);

	useEffect(() => {
		if (!open) return;
		const inside = (t: EventTarget | null) =>
			t instanceof Node &&
			(!!pillRef.current?.contains(t) || !!cardRef.current?.contains(t));
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const onDown = (e: MouseEvent) => {
			if (!inside(e.target)) setOpen(false);
		};
		const onScroll = (e: Event) => {
			if (e.target instanceof Node && cardRef.current?.contains(e.target)) return;
			setOpen(false);
		};
		const onResize = () => setOpen(false);
		window.addEventListener("keydown", onKey);
		window.addEventListener("mousedown", onDown);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open]);

	if (count === 0) return null;

	const toggle = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (open) {
			setOpen(false);
			return;
		}
		const rect = pillRef.current?.getBoundingClientRect();
		if (!rect) return;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const left = Math.max(
			SIDEBAR_CARD_MARGIN,
			Math.min(rect.left, vw - SIDEBAR_CARD_WIDTH - SIDEBAR_CARD_MARGIN),
		);
		const below = vh - rect.bottom - SIDEBAR_CARD_GAP - SIDEBAR_CARD_MARGIN;
		const above = rect.top - SIDEBAR_CARD_GAP - SIDEBAR_CARD_MARGIN;
		// Prefer below; flip up only when below is cramped and above has more.
		setPos(
			below >= 200 || below >= above
				? { position: "fixed", left, top: rect.bottom + SIDEBAR_CARD_GAP, maxHeight: below }
				: { position: "fixed", left, bottom: vh - rect.top + SIDEBAR_CARD_GAP, maxHeight: above },
		);
		setOpen(true);
	};

	const lit = hover || open;
	return (
		<>
			<button
				ref={pillRef}
				type="button"
				aria-expanded={open}
				aria-label={`${count === 1 ? "1 background task" : `${count} background tasks`}. Show tasks`}
				onClick={toggle}
				onMouseEnter={() => setHover(true)}
				onMouseLeave={() => setHover(false)}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					height: 22,
					padding: "0 9px",
					borderRadius: 11,
					// White at the same 14% / 40% alphas the status pills use for
					// their soft fill and border (okSoft/okBorder etc.); 24% on
					// hover/open, same step BabysitBadge takes.
					background: `color-mix(in oklab, ${T.text} ${lit ? 24 : 14}%, transparent)`,
					border: `0.5px solid color-mix(in oklab, ${T.text} 40%, transparent)`,
					fontSize: 11.5,
					fontFamily: "inherit",
					color: T.text,
					fontWeight: 500,
					letterSpacing: "0.1px",
					whiteSpace: "nowrap",
					flexShrink: 0,
					cursor: "pointer",
					transition: "background 80ms ease",
				}}
			>
				{/* Same 6px dot the status pills carry; white like the text so it
				    reads as a live signal without borrowing a status color. */}
				<span
					aria-hidden
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: T.text,
						flexShrink: 0,
					}}
				/>
				{count === 1 ? "1 task" : `${count} tasks`}
			</button>
			{open && pos
				? createPortal(
					<div
						// Stops React's portal bubbling from reaching the row's
						// <Link> (see docstring). Native default isn't touched,
						// so the Stop buttons still work.
						onClick={(e) => e.stopPropagation()}
					>
						<BackgroundTasksCard
							sessionId={sessionId}
							cardRef={cardRef}
							style={{ ...pos, zIndex: 10000 }}
						/>
					</div>,
					document.body,
				)
				: null}
		</>
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
