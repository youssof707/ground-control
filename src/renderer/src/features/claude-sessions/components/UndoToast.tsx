import { useEffect, useState } from "react";
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
 */

/** Visible lifetime of the toast. Long enough to notice, read a title, and
 *  reach the corner; short enough not to become clutter. */
const TOAST_MS = 8000;

export function UndoToast() {
	const navigate = useNavigate();
	const entries = useUndoStore((s) => s.entries);
	const toastEntryId = useUndoStore((s) => s.toastEntryId);
	const dismissToast = useUndoStore((s) => s.dismissToast);
	const [paused, setPaused] = useState(false);

	const entry = entries.find((e) => e.id === toastEntryId) ?? null;

	// Hovering must not just stop the clock — it has to restart it on leave, so
	// the user gets a fresh, full window rather than the sliver that was left
	// when they reached the card. Dropping `animationName` to "none" (below)
	// rather than pausing it does that for the fade: the card snaps back to
	// full opacity, and naming the animation again replays it from 0%. This
	// effect restarts the matching timeout for free, since `paused` is a dep.
	useEffect(() => {
		if (!entry || paused) return;
		const id = setTimeout(() => {
			// Re-read rather than closing over `dismissToast(entry.id)`: by now
			// the entry may have been restored and the toast advanced to the
			// next one, which deserves its own full timer.
			if (useUndoStore.getState().toastEntryId === entry.id) {
				useUndoStore.getState().dismissToast();
			}
		}, TOAST_MS);
		return () => clearTimeout(id);
	}, [entry, paused]);

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
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			style={{
				pointerEvents: "auto",
				width: "min(360px, calc(100vw - 40px))",
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				borderRadius: 10,
				boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
				overflow: "hidden",
				// The self-timing fade. Named "none" while hovered so the card
				// returns to full opacity rather than freezing mid-dissolve;
				// the transition below smooths that hand-back, and can't fight
				// the animation because it only applies once the animation has
				// stopped driving opacity.
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
