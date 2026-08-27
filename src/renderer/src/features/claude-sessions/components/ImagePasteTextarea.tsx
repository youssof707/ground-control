import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ClipboardEvent,
	type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import type {
	SessionMode,
	UserContentBlock,
	UserImageMediaType,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import {
	isDraftId,
	useDraftSessionsStore,
	type DraftSession,
} from "../stores/useDraftSessionsStore";
import {
	useQueuedMessagesStore,
	type QueuedMessage,
} from "../stores/useQueuedMessagesStore";
import type { PendingImage } from "../lib/pendingImage";
import { openImageInPreview } from "../lib/imageActions";
import { sendTurn } from "../lib/sendTurn";
import { appendPromptBlock, focusComposer } from "../lib/composerActions";
import { runHandoffDelete } from "../lib/handoffActions";
import { T } from "../../../design/tokens";
import { ModeToggle, isBranchStale } from "../../../design/Atoms";
import { DictationButton, type DictationHandle } from "./DictationButton";
import { CopyImageButton } from "./CopyImageButton";
import type { Shortcut } from "@shared/schemas/shortcuts";
import { ShortcutsMenuButton } from "./ShortcutsMenu";

interface Props {
	sessionId: string;
	disabled?: boolean;
	textareaHeight?: number;
	onContentHeightChange?: (height: number) => void;
	onStop?: () => void;
	interrupting?: boolean;
}

const SUPPORTED_IMAGE_TYPES: readonly UserImageMediaType[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

function toSupportedMediaType(t: string): UserImageMediaType | null {
	return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t)
		? (t as UserImageMediaType)
		: null;
}

// Stable reference so the "no draft images" selector default doesn't
// trigger re-renders on every store update.
const EMPTY_IMAGES: PendingImage[] = Object.freeze(
	[] as PendingImage[],
) as PendingImage[];

// Same deal for "no queued messages" — a fresh [] literal on every render
// would break the zustand selector's reference equality and re-render the
// composer on every unrelated store update.
const EMPTY_QUEUE: QueuedMessage[] = Object.freeze(
	[] as QueuedMessage[],
) as QueuedMessage[];

/**
 * Convert a draft session into a real one. Subscribes to `session:started`
 * BEFORE invoking startSession so we don't race the broadcast — the
 * renderer-side startSession promise won't resolve until the SDK loop ends,
 * so the real id only arrives via the event. Pattern lifted from the
 * pre-draft `SessionsList.startWith()` flow.
 */
function createSessionFromDraft(draft: DraftSession): Promise<string> {
	// A blank name box means "auto-name me": send the provisional `Session N`
	// placeholder (never an empty title — the sidebar row would render blank
	// for the beat between `session:started` and the first message's patch)
	// and leave `titleLocked` false so SessionManager.pushUserMessage still
	// derives the real title from that first message. A name the user typed
	// is sent locked and is never overwritten afterwards.
	const typedTitle = draft.title.trim().slice(0, 200);
	const expectedTitle = typedTitle || draft.defaultTitle;
	return new Promise((resolve, reject) => {
		let off: (() => void) | null = window.claude.on(
			"session:started",
			(p) => {
				const s = p as {
					id: string;
					title?: string;
					cwd?: string;
					sdkSessionId?: string;
				};
				// `session:started` broadcasts on EVERY runLoop start, not just
				// this one — resumes (see sendTurn's resume-if-needed and
				// useQueuedMessageFlusher) and forks fire it too. Blindly
				// resolving on the first event risks promoting this draft onto
				// an unrelated session; since "Handoff & delete" chains a
				// deferred delete off the resolved id, a misfire would send the
				// handoff into the wrong conversation AND delete the source.
				// A genuine newborn from `run()` has no sdkSessionId yet and
				// carries exactly the cwd/title we just asked for.
				if (s.sdkSessionId) return;
				if (s.cwd !== draft.cwd || s.title !== expectedTitle) return;
				off?.();
				off = null;
				clearTimeout(timer);
				resolve(s.id);
			},
		);
		// Without a timeout, a dropped or mismatched broadcast wedges the
		// composer in `sending` forever with no recovery but a reload.
		const timer = setTimeout(() => {
			off?.();
			off = null;
			reject(new Error("Timed out waiting for the new session to start."));
		}, 20_000);
		window.claude
			.startSession({
				title: expectedTitle,
				titleLocked: typedTitle.length > 0,
				cwd: draft.cwd,
				mode: draft.mode,
				// Carry the draft's worktree attachment forward. Main-side
				// SessionManager persists this onto the new session record
				// and rewires the SDK cwd to the worktree's checkout path
				// via resolveEffectiveCwd — see SessionManager.run.
				worktreeId: draft.worktreeId,
				// Carry the model override the user picked in the draft
				// header. Undefined = use the CLI default (SessionManager
				// stamps this onto the session record; the SDK loop reads
				// it on the first turn).
				model: draft.model,
				// Carry the sidebar group inherited from a handoff's source
				// session (undefined for ordinary drafts). Born-with rather
				// than set post-hoc — see DraftSession.groupId doc.
				groupId: draft.groupId,
			})
			.catch((err) => {
				off?.();
				off = null;
				clearTimeout(timer);
				reject(err);
			});
	});
}

export function ImagePasteTextarea({
	sessionId,
	disabled,
	textareaHeight = 44,
	onContentHeightChange,
	onStop,
	interrupting = false,
}: Props) {
	// Drafts (text + pasted images) live in a per-session in-memory Zustand
	// store so switching sessions doesn't carry the draft from one to the
	// next. See `useDraftStore` for details. The shim setters below preserve
	// the existing `setText(string)` / `setImages(prev => …)` call sites.
	const text = useDraftStore(
		(s) => s.draftsBySession[sessionId]?.text ?? "",
	);
	const images = useDraftStore(
		(s) => s.draftsBySession[sessionId]?.images ?? EMPTY_IMAGES,
	);
	const setText = (next: string) =>
		useDraftStore.getState().setDraftText(sessionId, next);
	const setImages = (
		next: PendingImage[] | ((prev: PendingImage[]) => PendingImage[]),
	) => {
		const current =
			useDraftStore.getState().draftsBySession[sessionId]?.images ?? [];
		const value = typeof next === "function" ? next(current) : next;
		useDraftStore.getState().setDraftImages(sessionId, value);
	};
	const [sending, setSending] = useState(false);
	const [dictating, setDictating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [modeSwitching, setModeSwitching] = useState(false);
	// Draft awareness — when the sessionId is a draft, status / mode / branch
	// don't exist in useSessionsStore yet. We read from useDraftSessionsStore
	// instead so the mode toggle is live during draft composition, and the
	// send handler can promote the draft to a real session.
	const isDraft = isDraftId(sessionId);
	const navigate = useNavigate();
	const draftSession = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft : null,
	);
	// Subscribe to mode so the toggle reflects live SDK / IPC updates (e.g.
	// `session:patch` broadcasts after a successful setMode in the main process).
	// For a draft, the source of truth is the draft store; the real-session
	// selector is still called (hooks rule) but its value is ignored.
	const realMode = useSessionsStore(
		(s) => s.sessions[sessionId]?.mode ?? "plan",
	);
	const mode: SessionMode = isDraft
		? (draftSession?.mode ?? "plan")
		: realMode;
	const status = useSessionsStore((s) => s.sessions[sessionId]?.status);
	const isRunning = status === "running";
	// Subscribe to the two branch fields so the send button mirrors the
	// BranchChip's stale (red) state — extra visibility for "you're about
	// to send on a different branch than your last message."
	const branch = useSessionsStore((s) => s.sessions[sessionId]?.branch);
	const lastUserMessageBranch = useSessionsStore(
		(s) => s.sessions[sessionId]?.lastUserMessageBranch,
	);
	const branchStale = isBranchStale({ branch, lastUserMessageBranch });

	// Queued pre-move(s) for this session — see useQueuedMessagesStore /
	// useQueuedMessageFlusher. The UI only ever lets one accumulate today
	// (the menu item below disables itself once the queue is non-empty), but
	// the store is already a FIFO array so a future multi-queue UI needs no
	// data-model change here.
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

	// Focus + caret to end whenever the Cmd+R composer-focus hotkey fires.
	// rAF so it runs after the draft-text write (and resulting re-render)
	// that composerActions.appendQuotedInline just triggered. Skipped on the
	// initial nonce (0) — session-entry focus is already handled above.
	const composerFocusNonce = useDraftStore((s) => s.composerFocusNonce);
	useEffect(() => {
		if (composerFocusNonce === 0) return;
		const raf = requestAnimationFrame(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = ta.value.length;
		});
		return () => cancelAnimationFrame(raf);
	}, [composerFocusNonce]);

	// Auto-grow the textarea to fit its content. We toggle height to "auto"
	// just long enough to read scrollHeight (the natural content height),
	// then restore the previous height so React's controlled style prop wins
	// on the next render. useLayoutEffect runs synchronously before paint,
	// so the brief swap never produces a visible flash. The measured value
	// is reported up to SessionChat, which combines it with the drag-set
	// baseline (Math.max) and feeds the result back as `textareaHeight`.
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
		if (modeSwitching || mode === next) return;
		if (isDraft) {
			// Draft sessions don't exist in main yet — no IPC to call. Just
			// update the in-memory draft so the chosen mode flows through to
			// the eventual startSession call in send().
			useDraftSessionsStore.getState().updateDraft({ mode: next });
			return;
		}
		// Optimistic flip; revert on IPC failure. The main process broadcasts
		// the canonical value back via session:patch on success.
		useSessionsStore.getState().upsertSession({ id: sessionId, mode: next });
		setModeSwitching(true);
		try {
			await window.claude.setSessionMode(sessionId, next);
		} catch (err) {
			useSessionsStore
				.getState()
				.upsertSession({ id: sessionId, mode });
			console.error("Failed to change session mode", err);
		} finally {
			setModeSwitching(false);
		}
	};

	/**
	 * Run a shortcut in this session: append its text to whatever is already
	 * in the composer (non-destructive — you can stack a shortcut on top of a
	 * half-typed thought) and flip the session's mode to match.
	 *
	 * `changeMode` already handles both branches (draft store vs. setMode
	 * IPC) and no-ops when the mode already matches, so there's no extra
	 * plumbing here. `focusComposer` bumps the composer-focus nonce, whose
	 * effect above refocuses and moves the caret to end once the draft-text
	 * re-render lands.
	 */
	const runShortcut = (sc: Shortcut) => {
		appendPromptBlock(sessionId, sc.prompt);
		void changeMode(sc.mode);
		focusComposer();
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = Array.from(e.clipboardData.items);
		const imageItems = items.filter((it) => it.type.startsWith("image/"));
		if (imageItems.length === 0) return;
		e.preventDefault();
		for (const item of imageItems) {
			const file = item.getAsFile();
			if (!file) continue;
			const mediaType = toSupportedMediaType(file.type);
			if (!mediaType) {
				setError(`Unsupported image type: ${file.type}`);
				continue;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result as string;
				const data = dataUrl.split(",")[1] ?? "";
				setImages((prev) => [
					...prev,
					{ media_type: mediaType, data, previewUrl: dataUrl },
				]);
			};
			reader.readAsDataURL(file);
		}
	};

	const removeImage = (idx: number) =>
		setImages((prev) => prev.filter((_, i) => i !== idx));

	// Shared by send() and queueMessage() — images first, then the text block,
	// matching the SDK's expected content-block order.
	const buildBlocks = (): UserContentBlock[] => {
		const blocks: UserContentBlock[] = [];
		for (const img of images) {
			blocks.push({
				type: "image",
				source: {
					type: "base64",
					media_type: img.media_type,
					data: img.data,
				},
			});
		}
		if (text.trim()) blocks.push({ type: "text", text: text.trim() });
		return blocks;
	};

	const send = async () => {
		if (sending) return;
		if (!text.trim() && images.length === 0) return;
		const blocks = buildBlocks();

		setSending(true);
		setError(null);
		try {
			let targetId = sessionId;
			// Deferred half of "Handoff & delete" — captured before
			// discardDraft() below nulls the slot. Only fired once the
			// promotion AND the first turn have both succeeded (see below),
			// so an abandoned or failed handoff never destroys the source.
			let handoffDeleteId: string | undefined;
			if (isDraft) {
				// Promote the draft to a real session before delivering the
				// message. createSessionFromDraft subscribes to session:started
				// BEFORE invoking startSession so we don't miss the broadcast;
				// useSessionsBootstrap also handles it and upserts the full
				// ClaudeSession into useSessionsStore, so by the time this
				// resolves sendTurn's appendMessage call has a valid row.
				const draft = useDraftSessionsStore.getState().draft;
				if (!draft || draft.id !== sessionId) {
					throw new Error("Draft session no longer exists");
				}
				handoffDeleteId = draft.handoffDeleteSessionId;
				targetId = await createSessionFromDraft(draft);
			}
			// sendTurn owns the resume-if-needed check, the sendUserMessage
			// IPC call, and the optimistic local echo — shared with
			// useQueuedMessageFlusher so a manually-sent turn and a flushed
			// pre-move go through identical logic.
			await sendTurn(targetId, blocks);
			useDraftStore.getState().clearDraft(sessionId);
			if (isDraft) {
				// Navigate BEFORE discardDraft so the DraftSessionChat doesn't
				// briefly render its "Draft no longer exists" fallback. The
				// route swap unmounts the draft view and mounts the real
				// SessionChat for `targetId`. `replace` so the back button
				// doesn't strand the user on the now-dead draft URL.
				navigate(`/sessions/${targetId}`, { replace: true });
				useDraftSessionsStore.getState().discardDraft();
				// Only now — successor exists (born with the source's
				// groupId, so pruneGroupIfEmpty always finds a member) and
				// has actually received the handoff turn. Fire-and-forget:
				// runHandoffDelete routes through the background-task store
				// so a failure surfaces there instead of on this (possibly
				// already-unmounted) composer.
				if (handoffDeleteId && handoffDeleteId !== targetId) {
					runHandoffDelete(handoffDeleteId);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	// Queue-message (the split-button's dropup menu action). Only offered
	// while running and only ever leaves the composer with one queued
	// message at a time — see the disabled state on the menu item below.
	// Never touches IPC: useQueuedMessageFlusher fires this once the
	// session's current turn is completely done.
	const queueMessage = () => {
		if (!text.trim() && images.length === 0) return;
		const blocks = buildBlocks();
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
		let restoredText = "";
		const restoredImages: PendingImage[] = [];
		for (const block of msg.blocks) {
			if (block.type === "text") {
				restoredText = restoredText
					? `${restoredText}\n${block.text}`
					: block.text;
			} else if (block.type === "image") {
				restoredImages.push({
					media_type: block.source.media_type,
					data: block.source.data,
					previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
				});
			}
		}
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
	// One-at-a-time in the UI today — the store is a FIFO array so a future
	// multi-queue UI is a pure UI-layer change (drop this check).
	const hasQueuedMessage = queuedMessages.length > 0;

	const sendAriaLabel =
		branchStale && lastUserMessageBranch
			? `Send (branch changed since last message, was "${lastUserMessageBranch}")`
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
				padding: "4px 32px 18px",
				background: T.win,
			}}
		>
			<div
				style={{
					position: "relative",
					maxWidth: 760,
					margin: "0 auto",
					borderRadius: 12,
					border: `0.5px solid ${T.border}`,
					background: T.surface,
					padding: 12,
					boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
				}}
			>
				{isRunning && onStop ? (
					<button
						type="button"
						onClick={onStop}
						disabled={interrupting}
						aria-label="Stop"
						style={{
							position: "absolute",
							top: 8,
							right: 8,
							zIndex: 1,
							height: 22,
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							padding: "0 8px",
							borderRadius: 5,
							border: `0.5px solid ${T.border}`,
							background: T.surfaceHi,
							color: T.text,
							fontFamily: "inherit",
							fontSize: 11.5,
							fontWeight: 500,
							lineHeight: 1,
							cursor: interrupting ? "default" : "pointer",
							opacity: interrupting ? 0.55 : 1,
						}}
					>
						<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
							<rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
						</svg>
						<span>{interrupting ? "Stopping…" : "Stop"}</span>
					</button>
				) : null}

				{queuedMessages.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-start",
							gap: 6,
							marginBottom: 10,
						}}
					>
						{queuedMessages.map((msg) => (
							<QueuedMessageChip
								key={msg.id}
								message={msg}
								error={queueError}
								onCancel={() =>
									useQueuedMessagesStore.getState().cancel(sessionId, msg.id)
								}
								onRestore={() => restoreQueuedMessage(msg)}
							/>
						))}
					</div>
				) : null}

				{images.length > 0 ? (
					<div
						style={{
							display: "flex",
							gap: 6,
							flexWrap: "wrap",
							marginBottom: 10,
						}}
					>
						{images.map((img, i) => (
							<PendingImageThumb
								key={i}
								img={img}
								onRemove={() => removeImage(i)}
								onError={setError}
							/>
						))}
					</div>
				) : null}

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
					autoFocus
					value={text}
					onChange={(e) => setText(e.target.value)}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					disabled={disabled || sending}
					placeholder="Reply to Claude…"
					style={{
						width: "100%",
						height: textareaHeight,
						resize: "none",
						background: "transparent",
						border: "none",
						outline: "none",
						color: T.text,
						fontFamily: T.sans,
						fontSize: 14,
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
						marginTop: 10,
						paddingTop: 10,
						borderTop: `0.5px solid ${T.borderSoft}`,
					}}
				>
					{dictating ? (
						<span style={{ fontSize: 11.5, color: T.textFaint }}>
							↵ to finish dictating
						</span>
					) : null}
					<div style={{ flex: 1 }} />
					<ShortcutsMenuButton
						placement="up"
						buttonClassName="btn btn-icon"
						disabled={disabled || sending}
						onRun={runShortcut}
					/>
					<DictationButton
						ref={dictationRef}
						disabled={disabled || sending}
						onRecordingChange={setDictating}
						onInsert={insertDictation}
						onError={setError}
					/>
					<ModeToggle
						mode={mode}
						onChange={(next) => void changeMode(next)}
						disabled={disabled || modeSwitching}
					/>
					{isRunning ? (
						// Split button: the session is running, so this message might
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
									{hasQueuedMessage ? (
										<div
											style={{
												padding: "6px 10px",
												fontSize: 12,
												color: T.textFaint,
												maxWidth: 220,
											}}
										>
											A message is already queued for this session.
										</div>
									) : (
										<SendMenuItem
											label="Queue message"
											onClick={queueMessage}
										/>
									)}
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
 * A queued pre-move, shown above the composer while its session is running
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
	onCancel,
	onRestore,
}: {
	message: QueuedMessage;
	error: string | undefined;
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
				maxWidth: "100%",
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
					maxWidth: 260,
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

/**
 * One pending-paste thumbnail: the image, a hover-revealed copy button, and
 * the always-visible "×" remove button.
 *
 * Extracted from the composer's `images.map` so each thumbnail owns its own
 * hover state — a single `hoveredIndex` on the parent would re-render every
 * thumbnail on each mouse move between them.
 */
function PendingImageThumb({
	img,
	onRemove,
	onError,
}: {
	img: PendingImage;
	onRemove: () => void;
	onError: (message: string | null) => void;
}) {
	const [hovered, setHovered] = useState(false);
	return (
		<div
			style={{ position: "relative" }}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<img
				src={img.previewUrl}
				alt=""
				// `img.data` (raw base64) rather than `previewUrl` — the handler
				// accepts either, but this skips shipping the redundant data-URL
				// prefix over IPC.
				onDoubleClick={() => {
					void openImageInPreview(img.media_type, img.data).then(
						// null on success, which also clears any stale error from
						// a previous failed attempt.
						onError,
					);
				}}
				style={{
					display: "block",
					height: 64,
					width: 64,
					objectFit: "cover",
					borderRadius: 6,
					border: `0.5px solid ${T.border}`,
					// Suppress the selection flash a double-click otherwise
					// paints over the thumbnail.
					userSelect: "none",
				}}
			/>
			{/* Top-left: the "×" already owns the top-right corner. Sized down
			    to 20px so it doesn't swamp a 64px thumbnail. */}
			<CopyImageButton
				mediaType={img.media_type}
				data={img.data}
				hovered={hovered}
				corner="left"
				size={20}
				inset={4}
			/>
			<button
				onClick={onRemove}
				aria-label="Remove"
				style={{
					position: "absolute",
					top: -6,
					right: -6,
					width: 20,
					height: 20,
					borderRadius: "50%",
					border: "none",
					background: T.text,
					color: T.bg,
					fontSize: 12,
					cursor: "pointer",
					lineHeight: 1,
				}}
			>
				×
			</button>
		</div>
	);
}
