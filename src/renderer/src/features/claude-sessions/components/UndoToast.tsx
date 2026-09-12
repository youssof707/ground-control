import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../../../design/tokens";
import { Kbd } from "../../../design/Atoms";
import { useUndoStore } from "../stores/useUndoStore";
import { restoreEntry } from "../lib/undoActions";

/**
 * The "you can take that back" prompt, shown for a few seconds after a session
 * is deleted, handed off, or archived. Renders inside `AmbientStack` (see
 * `MainApp`) in the bottom-left corner, directly above the background-task
 * chip — deleting a session with the worktree cascade spawns both, and they
 * should read as one event rather than two things fighting for the same
 * corner.
 *
 * It announces itself by fading out, not by counting down. There used to be a
 * drain hairline along the bottom edge; it read as a loading bar and pulled
 * the eye toward a notice that exists to be ignorable. The card now just holds
 * and dissolves (see `undo-toast-life` in index.css).
 *
 * A card, not a pill: the background-task indicator is `borderRadius: 999`
 * because it's a status glance, whereas this holds an action. It borrows the
 * geometry of that component's expanded error panel instead.
 *
 * The toast is a NOTIFICATION, not the mechanism. Dismissing it with × (or
 * letting it time out) never drops the undo — Shift+Cmd+Z and the "Recently
 * deleted" list keep working for as long as the buffer holds the entry.
 *
 * This is the app's first toast and it should stay the only one: it knows
 * about restorable sessions specifically and exposes no generic
 * `showToast(message)` entry point. The moment it goes generic, a deliberately
 * quiet app starts growing a notification corner.
 *
 * NOTE: no-tooltip rule. The Shift+Cmd+Z hint is always-rendered text, never a
 * hover reveal — a keyboard hint that only appears on hover is exactly what
 * that rule forbids.
 *
 * ---------------------------------------------------------------------------
 * EXPIRY: read this before touching the timing code.
 *
 * The card must be impossible to pin open. A previous version gated the
 * dismiss timer on a `paused` boolean set by onMouseEnter/onMouseLeave on the
 * keyed card div, and it hung permanently in three separate ways — all of them
 * variants of "the node was removed from under a stationary cursor, so
 * `mouseleave` never fired and `paused` latched true forever":
 *
 *   1. Clicking × or Undo. The pointer is on the card when it unmounts. From
 *      then on EVERY later toast was born already-paused, with no timer ever
 *      scheduled. One click poisoned the whole session.
 *   2. A second delete landing mid-hover — `key` changes, old node dies, new
 *      node mounts under the cursor with no enter/leave pair.
 *   3. Simply appearing under the cursor. This corner sits over the sessions
 *      sidebar, which is exactly where you just clicked ⋯ → Delete, so the
 *      card routinely mounts beneath a motionless pointer and Chromium
 *      recomputes hover on insert.
 *
 * The rules that keep it honest, in order of importance:
 *
 *   - Expiry is a WALL-CLOCK DEADLINE (`deadlineRef`), not a countdown that
 *     exists only while unpaused. Pausing moves the deadline; it never deletes
 *     it. Any code path that forgets to unpause costs at most `MAX_TOAST_MS`.
 *   - Pausing requires MOVEMENT (onMouseMove), never bare onMouseEnter. A card
 *     that appears under a still cursor is not being read.
 *   - `paused` is force-cleared whenever the shown entry changes, and on the
 *     window/document events that swallow `mouseleave` (blur, pointer leaving
 *     the window).
 *   - `MAX_TOAST_MS` is a hard ceiling from the moment the toast was raised.
 *     Hovering buys reading time; it cannot buy forever.
 *   - The renderer is background-throttled (BrowserWindow does not disable
 *     `backgroundThrottling`), so setTimeout is not real time. focus and
 *     visibilitychange re-check the deadline on return.
 */

/** Visible lifetime of the toast. Long enough to notice, read a title, and
 *  reach the corner; short enough not to become clutter. */
const TOAST_MS = 5000;

/** Hard ceiling on the card's life, measured from when it was raised, no
 *  matter how much it is hovered. The escape hatch that makes every "stuck
 *  hover" bug self-heal instead of hanging the corner. */
const MAX_TOAST_MS = 30000;

export function UndoToast() {
	const navigate = useNavigate();
	const entries = useUndoStore((s) => s.entries);
	const toastEntryId = useUndoStore((s) => s.toastEntryId);
	const dismissToast = useUndoStore((s) => s.dismissToast);
	const [paused, setPaused] = useState(false);

	const entry = entries.find((e) => e.id === toastEntryId) ?? null;
	const entryId = entry?.id ?? null;

	// When this toast's time is up, and the latest it may ever be. Refs, not
	// state: they are read by timers and written by pointer handlers, and a
	// re-render per mouse move would be absurd for a fade.
	const deadlineRef = useRef(0);
	const ceilingRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Raising a *different* entry is a fresh event: new window, new ceiling,
	// and — critically — pointer state reset. See latch cases 1 and 2 in the
	// header comment; without this line, dismissing one toast with × while
	// hovering silently disarms every toast that follows it.
	useEffect(() => {
		if (!entryId) return;
		const now = Date.now();
		deadlineRef.current = now + TOAST_MS;
		ceilingRef.current = now + MAX_TOAST_MS;
		setPaused(false);
	}, [entryId]);

	// Single owner of "is it time yet?". Re-checks the wall clock rather than
	// trusting that the timeout fired when it was asked to: a throttled or
	// frozen renderer can deliver it arbitrarily late, and hover can have
	// pushed the deadline out since it was scheduled.
	const tick = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = null;
		if (!entryId) return;

		const due = Math.min(deadlineRef.current, ceilingRef.current);
		const remaining = due - Date.now();
		if (remaining <= 0) {
			// Re-read rather than closing over `dismissToast(entryId)`: by now
			// the entry may have been restored and the toast advanced to the
			// next one, which deserves its own full window.
			if (useUndoStore.getState().toastEntryId === entryId) {
				useUndoStore.getState().dismissToast();
			}
			return;
		}
		timerRef.current = setTimeout(tick, remaining);
	}, [entryId]);

	// Hovering pushes the deadline out rather than stopping a clock, so there
	// is no state in which the toast has no way to die. The ceiling still
	// applies, so leaning on the card cannot hold the corner hostage.
	useEffect(() => {
		if (!entryId) return;
		if (paused) {
			// Keep a timer armed even while paused — the ceiling is the
			// backstop for a `paused` that somehow never gets cleared, and
			// it is the reason this component can no longer hang.
			if (timerRef.current) clearTimeout(timerRef.current);
			const left = Math.max(0, ceilingRef.current - Date.now());
			timerRef.current = setTimeout(tick, left);
			return;
		}
		// Unhovering (and first mount) grants a fresh full window, rather than
		// resuming the sliver that was left when the pointer arrived. Set here
		// rather than in the mouse handler so it lands before `tick` reads it,
		// and so it matches the CSS fade, which restarts at 0% on this render.
		deadlineRef.current = Date.now() + TOAST_MS;
		tick();
	}, [entryId, paused, tick]);

	useEffect(() => () => {
		if (timerRef.current) clearTimeout(timerRef.current);
	}, []);

	// The events that eat `mouseleave`. Switching apps or flicking the pointer
	// out of the window both leave the card believing it is still hovered;
	// returning focus also means the timer above may be overdue, so re-check
	// the clock immediately rather than waiting out a throttled timeout.
	useEffect(() => {
		if (!entryId) return;
		const release = () => setPaused(false);
		const recheck = () => {
			setPaused(false);
			tick();
		};
		window.addEventListener("blur", release);
		window.addEventListener("focus", recheck);
		document.addEventListener("mouseleave", release);
		document.addEventListener("visibilitychange", recheck);
		return () => {
			window.removeEventListener("blur", release);
			window.removeEventListener("focus", recheck);
			document.removeEventListener("mouseleave", release);
			document.removeEventListener("visibilitychange", recheck);
		};
	}, [entryId, tick]);

	if (!entry) return null;

	// Line 2 — rendered only when it has something to say. The worktree loss
	// outranks the pile-up count: one is a permanent consequence, the other is
	// just bookkeeping.
	const remaining = entries.length - 1;
	const secondLine = entry.worktreeDeleted
		? "Its worktree was deleted and won't come back."
		: remaining > 0
			? `${remaining} more can be restored.`
			: null;

	// The handoff wording is deliberately different from the other two. By the
	// time a "Handoff & delete" actually lands, the user is looking at a
	// brand-new session, and an unexplained "Deleted …" appearing there reads
	// as an error report. Naming the handoff explains why the toast is here.
	const headline =
		entry.kind === "handoff"
			? `Handed off — deleted "${entry.title}"`
			: entry.kind === "archive"
				? `Archived "${entry.title}"`
				: `Deleted "${entry.title}"`;

	return (
		<div
			// Remounts when the toast advances to a different entry — a second
			// delete landing mid-fade must start its own full window, not
			// inherit the half-dissolved opacity of the one it replaced.
			// Remounting is the only way to replay a CSS animation.
			key={entry.id}
			role="status"
			aria-live="polite"
			// MOVEMENT, not entry. This corner sits over the sessions sidebar,
			// so the card routinely mounts under a cursor that is just resting
			// where the ⋯ menu was. Moving across it means someone is reading
			// it; being born beneath a motionless pointer does not, and
			// treating the two the same is what used to pin the card open.
			onMouseMove={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			style={{
				pointerEvents: "auto",
				width: "min(360px, calc(100vw - 40px))",
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				borderRadius: 10,
				boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
				overflow: "hidden",
				// The fade is DECORATION — the tick effect above owns the actual
				// expiry, so a throttled or dropped animation can never strand
				// the card on screen. They stay in step because leaving the
				// card grants a fresh full `TOAST_MS`, which is exactly the
				// duration below: flipping the name back off "none" replays the
				// animation from 0% against a matching deadline.
				//
				// Named "none" while hovered so the card returns to full
				// opacity rather than freezing mid-dissolve; the transition
				// below smooths that hand-back, and can't fight the animation
				// because it only applies once the animation has stopped
				// driving opacity.
				animationName: paused ? "none" : "undo-toast-life",
				animationDuration: `${TOAST_MS}ms`,
				animationTimingFunction: "linear",
				animationFillMode: "forwards",
				transition: "opacity 150ms ease-out",
			}}
		>
			<div
				style={{
					padding: "9px 10px 9px 12px",
					display: "flex",
					flexDirection: "column",
					gap: 3,
				}}
			>
				<div
					style={{ display: "flex", alignItems: "center", gap: 8 }}
				>
					{/* The title is the only thing identifying WHICH session,
					    so it gets the space and everything else shrinks. */}
					<span
						style={{
							flex: 1,
							minWidth: 0,
							fontSize: 13,
							color: T.text,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{headline}
					</span>
					{/* Grey, not accent-blue. A saturated link in an ambient
					    corner reads as an alert demanding a decision; this is
					    an offer you're free to ignore, and the whole card is
					    already fading out behind it. Brightens to full text
					    colour on hover so it still declares itself clickable
					    without the colour cue — same inline-style hover trick
					    as the × beside it. */}
					<button
						type="button"
						onClick={() => restoreEntry(entry, navigate)}
						style={{
							flexShrink: 0,
							border: "none",
							background: "transparent",
							color: T.textDim,
							fontSize: 12,
							fontWeight: 500,
							fontFamily: T.sans,
							cursor: "pointer",
							padding: "1px 3px",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.color = T.text;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.color = T.textDim;
						}}
					>
						Undo
					</button>
					<Kbd>⇧⌘Z</Kbd>
					<button
						type="button"
						onClick={dismissToast}
						aria-label="Dismiss"
						style={{
							flexShrink: 0,
							width: 20,
							height: 20,
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: 5,
							border: "none",
							background: "transparent",
							color: T.textFaint,
							cursor: "pointer",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = T.surfaceHi;
							e.currentTarget.style.color = T.text;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "transparent";
							e.currentTarget.style.color = T.textFaint;
						}}
					>
						{/* Same glyph as ConfirmModal's corner dismiss. */}
						<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
							<path
								d="M2.5 2.5l7 7M9.5 2.5l-7 7"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>
				{secondLine ? (
					<span style={{ fontSize: 11, color: T.textMute }}>
						{secondLine}
					</span>
				) : null}
			</div>
		</div>
	);
}
