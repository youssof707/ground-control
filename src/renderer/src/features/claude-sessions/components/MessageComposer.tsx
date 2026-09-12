import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import type { SessionMode } from "@shared/claude-sessions/types";
import { useDraftStore } from "../stores/useDraftStore";
import {
	useQueuedMessagesStore,
	type QueuedMessage,
} from "../stores/useQueuedMessagesStore";
import { buildUserBlocks, draftFromBlocks } from "../lib/composerImages";
import { useComposerImages } from "../hooks/useComposerImages";
import { useComposerTarget } from "../hooks/useComposerTarget";
import { appendPromptBlock } from "../lib/composerActions";
import { T } from "../../../design/tokens";
import { ModeToggle, isBranchStale } from "../../../design/Atoms";
import { DictationButton, type DictationHandle } from "./DictationButton";
import { PendingImageStrip } from "./PendingImageThumb";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { ShortcutsMenuButton } from "./ShortcutsMenu";

type Density = "full" | "compact";

interface Props {
	sessionId: string;
	disabled?: boolean;
	textareaHeight?: number;
	onContentHeightChange?: (height: number) => void;
	/** "compact" is used by the sidequest panel, which resizes as narrow as
	 * 280px (SIDEQUEST_MIN_WIDTH) — only chrome (padding, max-width, font
	 * size, thumbnail size, footer wrapping) changes between the two; every
	 * feature and handler below is identical regardless of density. */
	density?: Density;
}

// Chrome-only differences between the two hosts. Everything else — markup,
// handlers, features — is shared; see the Props doc above.
const DENSITY: Record<
	Density,
	{
		outerPadding: string;
		cardMaxWidth: number | undefined;
		cardMargin: string;
		cardPadding: number;
		cardRadius: number;
		cardBackground: string;
		cardShadow: string;
		textFontSize: number;
		thumbSize: number | undefined;
		footerFlexWrap: "nowrap" | "wrap";
		chipMaxWidth: number;
	}
> = {
	full: {
		outerPadding: "4px 32px 18px",
		cardMaxWidth: 760,
		cardMargin: "0 auto",
		cardPadding: 12,
		cardRadius: 12,
		cardBackground: T.surface,
		cardShadow: "0 8px 24px rgba(0,0,0,0.25)",
		textFontSize: 14,
		thumbSize: undefined,
		footerFlexWrap: "nowrap",
		chipMaxWidth: 260,
	},
	compact: {
		outerPadding: "10px 16px 16px",
		cardMaxWidth: undefined,
		cardMargin: "0",
		cardPadding: 10,
		cardRadius: 10,
		cardBackground: T.surfaceLow,
		cardShadow: "none",
		textFontSize: 13,
		thumbSize: 48,
		footerFlexWrap: "wrap",
		chipMaxWidth: 160,
	},
};

// A fresh [] literal on every render would break the zustand selector's
// reference equality and re-render the composer on every unrelated store
// update. (The images equivalent lives in `lib/composerImages`, shared with
// every composer instance.)
const EMPTY_QUEUE: QueuedMessage[] = Object.freeze(
	[] as QueuedMessage[],
) as QueuedMessage[];

/**
 * The message composer, shared by the main chat (`SessionChat`,
 * `DraftSessionChat`) and the sidequest panel. All per-target branching
 * (session vs. draft vs. sidequest — different state stores, different send
 * paths, different lifecycle) lives behind `useComposerTarget`; this
 * component has exactly one code path regardless of what `sessionId` points
 * at.
 */
export function MessageComposer({
	sessionId,
	disabled,
	textareaHeight = 44,
	onContentHeightChange,
	density = "full",
}: Props) {
	const D = DENSITY[density];
	const target = useComposerTarget(sessionId);

	// Drafts (text + pasted images) live in a per-session in-memory Zustand
	// store so switching sessions doesn't carry the draft from one to the
	// next. See `useDraftStore` for details. The shim setters below preserve
	// the existing `setText(string)` / `setImages(prev => …)` call sites.
	const text = useDraftStore(
		(s) => s.draftsBySession[sessionId]?.text ?? "",
	);
	const setText = (next: string) =>
		useDraftStore.getState().setDraftText(sessionId, next);
	const [sending, setSending] = useState(false);
	const [dictating, setDictating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Paste-to-attach, shared by every composer instance.
	const { images, onPaste, removeImage, setImages } = useComposerImages(
		sessionId,
		setError,
	);
	const [modeSwitching, setModeSwitching] = useState(false);

	// Subscribe to the two branch fields so the send button mirrors the
	// BranchChip's stale (red) state — extra visibility for "you're about
	// to send on a different branch than your last message." Undefined for
	// draft/sidequest targets, which reads as "not stale".
	const branchStale = isBranchStale({
		branch: target.branch,
		lastUserMessageBranch: target.lastUserMessageBranch,
	});

	// Queued pre-move(s) for this target — see useQueuedMessagesStore /
	// useQueuedMessageFlusher. The UI only ever lets one accumulate today
	// (the menu item below disables itself once the queue is non-empty), but
	// the store is already a FIFO array so a future multi-queue UI needs no
	// data-model change here. Flushed for sidequests the same way as real
	// sessions — see the flusher's sidequest half.
	const queuedMessages = useQueuedMessagesStore(
		(s) => s.queuesBySession[sessionId] ?? EMPTY_QUEUE,
	);
	const queueError = useQueuedMessagesStore(
		(s) => s.errorsBySession[sessionId],
	);
	const [sendMenuOpen, setSendMenuOpen] = useState(false);
	const sendMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!sendMenuOpen) return;
		const onDocClick = (e: MouseEvent) => {
			if (sendMenuRef.current && !sendMenuRef.current.contains(e.target as Node)) {
				setSendMenuOpen(false);
			}
		};
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") setSendMenuOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [sendMenuOpen]);

	// Auto-focus the textarea on session entry / switch. Keyed on sessionId
	// so the focus also fires when navigating between sessions, not just the
	// initial mount. The setTimeout(…, 0) defers focus past the same tick as
	// any route transition / layout work so the call lands on the real DOM
	// node after it has been (re)mounted.
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const dictationRef = useRef<DictationHandle>(null);
	useEffect(() => {
		const id = window.setTimeout(() => {
			textareaRef.current?.focus();
		}, 0);
		return () => window.clearTimeout(id);
	}, [sessionId]);

	// Focus + caret to end whenever this target's focus-request nonce fires
	// (Cmd+R quoting into the composer, Cmd+S / Clear on the sidequest side).
	// rAF so it runs after the draft-text write (and resulting re-render)
	// that triggered the request. Skipped on the initial nonce (0) —
	// session-entry focus is already handled above.
	const focusNonce = target.focusNonce;
	useEffect(() => {
		if (focusNonce === 0) return;
		const raf = requestAnimationFrame(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = ta.value.length;
		});
		return () => cancelAnimationFrame(raf);
	}, [focusNonce]);

	// Auto-grow the textarea to fit its content. We toggle height to "auto"
	// just long enough to read scrollHeight (the natural content height),
	// then restore the previous height so React's controlled height prop
	// wins on the next render. useLayoutEffect runs synchronously before
	// paint, so the brief swap never produces a visible flash. The measured
	// value is reported up to the host, which combines it with the drag-set
	// baseline (Math.max) and feeds the result back as `textareaHeight` —
	// see `useComposerResize`.
	useLayoutEffect(() => {
		const ta = textareaRef.current;
		if (!ta || !onContentHeightChange) return;
		const prev = ta.style.height;
		ta.style.height = "auto";
		const sh = ta.scrollHeight;
		ta.style.height = prev;
		onContentHeightChange(sh);
	}, [text, onContentHeightChange]);

	const changeMode = async (next: SessionMode) => {
		if (modeSwitching || target.starting || target.mode === next) return;
		setModeSwitching(true);
		try {
			await target.changeMode(next);
		} catch (err) {
			// Sidequest mode changes have no persisted record and no visible
			// affordance besides this composer, so surface the failure inline.
			// Real/draft sessions keep the prior (silent) behavior — the
			// optimistic flip already reverted, and nothing else in the UI
			// depends on this promise settling.
			if (target.kind === "sidequest") {
				setError(err instanceof Error ? err.message : String(err));
			} else {
				console.error("Failed to change session mode", err);
			}
		} finally {
			setModeSwitching(false);
		}
	};

	/**
	 * Run a shortcut in this composer: append its text to whatever is already
	 * there (non-destructive — you can stack a shortcut on top of a
	 * half-typed thought) and flip the target's mode to match.
	 *
	 * `changeMode` above already handles every target kind and no-ops when
	 * the mode already matches, so there's no extra plumbing here.
	 * `target.requestFocus()` bumps this target's own focus nonce, whose
	 * effect above refocuses and moves the caret to end once the draft-text
	 * re-render lands.
	 */
	const runShortcut = (sc: Shortcut) => {
		appendPromptBlock(sessionId, sc.prompt);
		void changeMode(sc.mode);
		target.requestFocus();
	};

	/**
	 * Run a skill in this composer: append its slash command. Skills carry no
	 * mode (unlike shortcuts), so the target's current mode is left alone.
	 */
	const runSkill = (skill: Skill) => {
		appendPromptBlock(sessionId, `/${skill.name}`);
		target.requestFocus();
	};

	const send = async () => {
		if (sending) return;
		if (!text.trim() && images.length === 0) return;
		const blocks = buildUserBlocks(text, images);

		setSending(true);
		setError(null);
		try {
			await target.send(blocks);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	// Queue-message (the split-button's dropup menu action). Only offered
	// while running; can be used repeatedly — messages append to the
	// target's FIFO and render as a horizontal chip strip above the
	// composer. Never touches IPC directly: useQueuedMessageFlusher fires
	// these one per turn as each turn completes.
	const queueMessage = () => {
		if (!text.trim() && images.length === 0) return;
		const blocks = buildUserBlocks(text, images);
		const trimmed = text.trim();
		useQueuedMessagesStore.getState().enqueue(sessionId, {
			id: crypto.randomUUID(),
			blocks,
			preview: trimmed,
			imageCount: images.length,
		});
		useQueuedMessagesStore.getState().setError(sessionId, null);
		useDraftStore.getState().clearDraft(sessionId);
		setSendMenuOpen(false);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	// Clicking a queued chip (QueuedMessageChip below) pulls it back out of
	// the queue and drops its content into the composer — the only way to
	// reach a message that's stuck waiting (most commonly: held after Stop)
	// short of just letting it fire or cancelling it outright. Rebuilds
	// `text`/`images` from the stored blocks rather than the
	// `preview`/`imageCount` summary, so nothing is lost on the round trip.
	const restoreQueuedMessage = (msg: QueuedMessage) => {
		const { text: restoredText, images: restoredImages } = draftFromBlocks(
			msg.blocks,
		);
		useQueuedMessagesStore.getState().cancel(sessionId, msg.id);
		useQueuedMessagesStore.getState().setError(sessionId, null);
		setText(restoredText);
		setImages(restoredImages);
		requestAnimationFrame(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = restoredText.length;
		});
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key !== "Enter") return;

		// Plain Enter → send
		if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			// While dictating, Enter commits the recording instead of sending —
			// so you can stop talking and hit Enter without firing off a
			// half-finished message. A second Enter sends.
			if (dictationRef.current?.commitIfRecording()) return;
			void send();
			return;
		}

		// Cmd+Enter → insert newline at cursor (not native on macOS)
		if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			const ta = e.currentTarget;
			const start = ta.selectionStart ?? text.length;
			const end = ta.selectionEnd ?? text.length;
			const next = text.slice(0, start) + "\n" + text.slice(end);
			setText(next);
			requestAnimationFrame(() => {
				ta.selectionStart = ta.selectionEnd = start + 1;
			});
			return;
		}

		// Shift+Enter and anything else: let the browser handle it.
	};

	// Enter commits an in-progress recording no matter where focus is — you
	// shouldn't have to click back into the box to finish dictating. Capture
	// phase so we win before any element-level handler (including the
	// textarea's own onKeyDown above) sees the key.
	useEffect(() => {
		if (!dictating) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Enter") return;
			if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			// Don't steal Enter from some *other* text field (rename inputs,
			// the note editor) — only from the composer or from nothing.
			if (
				target
				&& target !== textareaRef.current
				&& (target.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
			) {
				return;
			}
			if (!dictationRef.current?.commitIfRecording()) return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [dictating]);

	// Escape discards an in-progress recording — nothing is transcribed or
	// inserted. Mirrors the Enter listener above (capture phase, mounted only
	// while recording, other text fields excluded). We only swallow the key
	// when a recording was actually cancelled, so Escape still reaches the
	// send menu / modals / context menus the rest of the time.
	useEffect(() => {
		if (!dictating) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (
				target
				&& target !== textareaRef.current
				&& (target.isContentEditable
					|| ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
			) {
				return;
			}
			if (!dictationRef.current?.cancelIfRecording()) return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [dictating]);

	// Insert dictated text at the caret (replacing any selection), mirroring
	// the Cmd+Enter newline-insert pattern above. Adds a leading space when
	// gluing onto existing non-whitespace text.
	const insertDictation = (t: string) => {
		const ta = textareaRef.current;
		const start = ta?.selectionStart ?? text.length;
		const end = ta?.selectionEnd ?? text.length;
		const sep = start > 0 && !/\s$/.test(text.slice(0, start)) ? " " : "";
		const next = text.slice(0, start) + sep + t + text.slice(end);
		setText(next);
		requestAnimationFrame(() => {
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = start + sep.length + t.length;
		});
	};

	const canSend = !!(text.trim() || images.length > 0);
	// `starting` (sidequest fork still being handed to the SDK) deliberately
	// does NOT gate the textarea: Cmd+S forks and immediately focuses the
	// panel, so the user types straight into a still-starting sidequest.
	// It only gates the settings row below.
	const inputDisabled = disabled || sending;
	const settingsDisabled = disabled || sending || target.starting;

	const sendAriaLabel =
		branchStale && target.lastUserMessageBranch
			? `Send (branch changed since last message, was "${target.lastUserMessageBranch}")`
			: "Send";

	// Shared between the plain and split renderings of the Send button below.
	const sendContent = (
		<>
			{branchStale && !sending ? (
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					aria-hidden
				>
					<path
						d="M6 1.6 L11 10.4 H1 Z"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path
						d="M6 5 V7.3"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
					<circle cx="6" cy="9" r="0.7" fill="currentColor" />
				</svg>
			) : null}
			{sending ? "…" : "Send"}
			{!sending ? (
				<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
					<path
						d="M2 6h8M7 3l3 3-3 3"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : null}
		</>
	);

	return (
		<div
			style={{
				flexShrink: 0,
				padding: D.outerPadding,
				background: T.win,
			}}
		>
			<div
				style={{
					position: "relative",
					maxWidth: D.cardMaxWidth,
					margin: D.cardMargin,
					borderRadius: D.cardRadius,
					border: `0.5px solid ${T.border}`,
					background: D.cardBackground,
					padding: D.cardPadding,
					boxShadow: D.cardShadow,
				}}
			>
				{queuedMessages.length > 0 ? (
					<div
						style={{
							display: "flex",
							gap: 6,
							marginBottom: 10,
							overflowX: "auto",
							// The global ::-webkit-scrollbar is 10px tall — chunky next
							// to 22px chips, so this strip asks for the thin variant.
							scrollbarWidth: "thin",
						}}
					>
						{queuedMessages.map((msg, i) => (
							<QueuedMessageChip
								key={msg.id}
								message={msg}
								// A failed flush unshifts the message back to the head and
								// holds the queue, so the error belongs to the first chip
								// only — the rest are just waiting behind it.
								error={i === 0 ? queueError : undefined}
								maxWidth={D.chipMaxWidth}
								onCancel={() =>
									useQueuedMessagesStore.getState().cancel(sessionId, msg.id)
								}
								onRestore={() => restoreQueuedMessage(msg)}
							/>
						))}
					</div>
				) : null}

				<PendingImageStrip
					images={images}
					size={D.thumbSize}
					onRemove={removeImage}
					onError={setError}
				/>

				{error ? (
					<div
						className="message message-error"
						style={{
							padding: 8,
							fontSize: 12,
							marginBottom: 10,
							textAlign: "left",
						}}
					>
						{error}
					</div>
				) : null}

				<textarea
					ref={textareaRef}
					// Read by the global Cmd+K handler (`useCommandPaletteHotkey`) to
					// know which session's composer is focused, without threading
					// route state into that hook. Omitted for sidequests — see
					// `ComposerTarget.stampComposerAttr`.
					{...(target.stampComposerAttr
						? { "data-composer-session-id": sessionId }
						: {})}
					autoFocus
					value={text}
					onChange={(e) => setText(e.target.value)}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					disabled={inputDisabled}
					placeholder={target.placeholder}
					style={{
						width: "100%",
						height: textareaHeight,
						resize: "none",
						background: "transparent",
						border: "none",
						outline: "none",
						color: T.text,
						fontFamily: T.sans,
						fontSize: D.textFontSize,
						lineHeight: 1.5,
						padding: 0,
						overflowY: "auto",
					}}
				/>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: D.footerFlexWrap,
						marginTop: 10,
						paddingTop: 10,
						borderTop: `0.5px solid ${T.borderSoft}`,
					}}
				>
					{dictating ? (
						<span style={{ fontSize: 11.5, color: T.textFaint }}>
							↵ finish · esc cancel
						</span>
					) : null}
					<div style={{ flex: 1, minWidth: 0 }} />
					<ShortcutsMenuButton
						buttonClassName="btn btn-icon"
						disabled={settingsDisabled}
						onRun={runShortcut}
						onRunSkill={runSkill}
					/>
					<DictationButton
						ref={dictationRef}
						disabled={settingsDisabled}
						onRecordingChange={setDictating}
						onInsert={insertDictation}
						onError={setError}
						scope={sessionId}
					/>
					<ModeToggle
						mode={target.mode}
						onChange={(next) => void changeMode(next)}
						disabled={settingsDisabled || modeSwitching}
					/>
					{target.isRunning ? (
						// Split button: the target is running, so this message might
						// land mid-turn as an interjection (left half, unchanged
						// behavior) — or the caret opens a menu to queue it for
						// after the turn completely finishes instead (a chess-style
						// pre-move; see useQueuedMessagesStore).
						<div
							ref={sendMenuRef}
							style={{ position: "relative", display: "inline-flex" }}
						>
							<button
								onClick={send}
								disabled={disabled || sending || !canSend}
								className={`btn ${branchStale ? "btn-destructive" : "btn-primary"}`}
								aria-label={sendAriaLabel}
								style={{
									opacity: 0.55,
									cursor: "default",
									borderRadius: "8px 0 0 8px",
								}}
							>
								{sendContent}
							</button>
							<button
								type="button"
								onClick={() => setSendMenuOpen((o) => !o)}
								disabled={disabled || sending || !canSend}
								className={`btn ${branchStale ? "btn-destructive" : "btn-primary"}`}
								aria-haspopup="menu"
								aria-expanded={sendMenuOpen}
								aria-label="Send options"
								style={{
									width: 26,
									padding: 0,
									borderRadius: "0 8px 8px 0",
									borderLeft: `0.5px solid ${
										branchStale
											? "rgba(255,255,255,0.28)"
											: "rgba(26,20,16,0.22)"
									}`,
									// Full opacity while enabled — unlike the main half,
									// this is the live control right now, so it must not
									// read as disabled just because the turn is running.
									opacity: disabled || sending || !canSend ? 0.55 : 1,
								}}
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 12 12"
									fill="none"
									aria-hidden
								>
									<path
										d="M2.5 7L6 3.5 9.5 7"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
							{sendMenuOpen ? (
								<div
									role="menu"
									style={{
										position: "absolute",
										bottom: "calc(100% + 4px)",
										right: 0,
										minWidth: 180,
										background: T.surfaceHi,
										border: `0.5px solid ${T.border}`,
										borderRadius: 8,
										padding: 4,
										zIndex: 50,
										boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
									}}
								>
									<SendMenuItem
										label="Queue message"
										onClick={queueMessage}
									/>
								</div>
							) : null}
						</div>
					) : (
						<button
							onClick={send}
							disabled={disabled || sending || !canSend}
							className={`btn ${branchStale ? "btn-destructive" : "btn-primary"}`}
							aria-label={sendAriaLabel}
						>
							{sendContent}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Menu row for the split-send button's caret dropdown ("Queue message").
 * A small private component rather than a shared import — the shortcuts
 * menu has its own equivalent private item for the same reason ShortcutsMenu
 * doesn't reuse SessionsList's `MenuItem`: not worth wiring a shared import
 * for an 8-line button.
 */
function SendMenuItem({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			style={{
				display: "flex",
				alignItems: "center",
				width: "100%",
				textAlign: "left",
				padding: "6px 10px",
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.text,
				fontSize: 13,
				cursor: "pointer",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = T.surface;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
			}}
		>
			<span
				style={{
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
				}}
			>
				{label}
			</span>
		</button>
	);
}

/**
 * A queued pre-move, shown above the composer while its target is running
 * (or, if a flush attempt failed, until cancelled). Visually paired with the
 * Stop pill's pill/chip language (same height/radius/border) so the two read
 * as siblings describing "what's happening with this turn".
 *
 * Clicking the chip (anywhere but the × ) is the only way back in — it pulls
 * the message out of the queue and drops its text/images into the composer
 * for editing or a manual send. That matters most right after Stop, where
 * the queue is held rather than fired and would otherwise just sit there
 * with no way to reach it short of cancelling it outright.
 */
function QueuedMessageChip({
	message,
	error,
	maxWidth,
	onCancel,
	onRestore,
}: {
	message: QueuedMessage;
	error: string | undefined;
	maxWidth: number;
	onCancel: () => void;
	onRestore: () => void;
}) {
	const [hovered, setHovered] = useState(false);
	const danger = !!error;
	const label = error
		? `Failed to send — ${error}`
		: message.preview
			|| `${message.imageCount} image${message.imageCount === 1 ? "" : "s"}`;
	return (
		<div
			onClick={onRestore}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				// Chips live in a horizontal scroller — keep intrinsic width and
				// overflow into the scroll instead of squishing to fit.
				flexShrink: 0,
				height: 22,
				padding: "0 4px 0 8px",
				borderRadius: 5,
				// The border brightens on hover as the only affordance that this
				// chip is interactive (click to restore) — no tooltip. Same
				// hover border-color as the shared `.btn` class.
				border: `0.5px solid ${
					danger
						? T.dangerBorder
						: hovered
							? "oklch(0.36 0.010 60)"
							: T.border
				}`,
				background: danger ? T.dangerSoft : T.surfaceHi,
				color: danger ? T.danger : T.textDim,
				fontSize: 11.5,
				cursor: "pointer",
			}}
		>
			{/* Clock glyph — this message is waiting, not in flight. */}
			<svg
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				aria-hidden
				style={{ flexShrink: 0 }}
			>
				<circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.1" />
				<path
					d="M5 2.6V5l1.8 1.2"
					stroke="currentColor"
					strokeWidth="1.1"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span
				style={{
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					maxWidth,
				}}
			>
				{label}
			</span>
			<button
				type="button"
				onClick={(e) => {
					// Without this, the click would bubble up and also fire the
					// chip's onClick restore handler — stop it there so cancel
					// stays cancel.
					e.stopPropagation();
					onCancel();
				}}
				aria-label="Cancel queued message"
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					flexShrink: 0,
					width: 16,
					height: 16,
					borderRadius: "50%",
					border: "none",
					background: "transparent",
					color: "inherit",
					fontSize: 12,
					lineHeight: 1,
					cursor: "pointer",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = danger
						? "rgba(255,255,255,0.12)"
						: T.surface;
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = "transparent";
				}}
			>
				×
			</button>
		</div>
	);
}
