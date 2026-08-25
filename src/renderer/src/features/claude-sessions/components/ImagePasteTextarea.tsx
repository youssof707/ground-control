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
import type { PendingImage } from "../lib/pendingImage";
import { openImageInPreview } from "../lib/imageActions";
import { T } from "../../../design/tokens";
import { ModeToggle, isBranchStale } from "../../../design/Atoms";
import { DictationButton, type DictationHandle } from "./DictationButton";
import { CopyImageButton } from "./CopyImageButton";
import type { PromptShortcut } from "@shared/schemas/promptShortcuts";
import { usePromptShortcutsStore } from "../stores/usePromptShortcutsStore";
import { promptShortcutLabel } from "./PromptShortcutForm";
import { CreatePromptShortcutModal } from "./CreatePromptShortcutModal";
import { EditPromptShortcutsModal } from "./EditPromptShortcutsModal";

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
	return new Promise((resolve, reject) => {
		let off: (() => void) | null = window.claude.on(
			"session:started",
			(p) => {
				const s = p as { id: string };
				off?.();
				off = null;
				resolve(s.id);
			},
		);
		window.claude
			.startSession({
				title: typedTitle || draft.defaultTitle,
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
			})
			.catch((err) => {
				off?.();
				off = null;
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
	 * Run an in-session prompt shortcut: append its text to whatever is
	 * already in the composer (non-destructive — you can stack a shortcut on
	 * top of a half-typed thought) and flip the session's mode to match.
	 *
	 * `changeMode` already handles both branches (draft store vs. setMode
	 * IPC) and no-ops when the mode already matches, so there's no extra
	 * plumbing here. The rAF refocus mirrors `insertDictation` and lets the
	 * auto-grow layout effect re-measure before we move the caret.
	 */
	const runPromptShortcut = (sc: PromptShortcut) => {
		const next = text.trim()
			? `${text.replace(/\s+$/, "")}\n${sc.prompt}`
			: sc.prompt;
		setText(next);
		void changeMode(sc.mode);
		requestAnimationFrame(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			ta.focus();
			ta.selectionStart = ta.selectionEnd = next.length;
		});
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

	const send = async () => {
		if (sending) return;
		if (!text.trim() && images.length === 0) return;
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

		setSending(true);
		setError(null);
		try {
			let targetId = sessionId;
			if (isDraft) {
				// Promote the draft to a real session before delivering the
				// message. createSessionFromDraft subscribes to session:started
				// BEFORE invoking startSession so we don't miss the broadcast;
				// useSessionsBootstrap also handles it and upserts the full
				// ClaudeSession into useSessionsStore, so by the time this
				// resolves the appendMessage call below has a valid row.
				const draft = useDraftSessionsStore.getState().draft;
				if (!draft || draft.id !== sessionId) {
					throw new Error("Draft session no longer exists");
				}
				targetId = await createSessionFromDraft(draft);
			} else {
				const sess = useSessionsStore.getState().sessions[sessionId];
				const isOpen =
					sess?.status === "running" ||
					sess?.status === "idle" ||
					sess?.status === "awaiting_permission";
				if (!isOpen && sess?.sdkSessionId) {
					await window.claude.resumeSession(sessionId);
				}
			}
			await window.claude.sendUserMessage({ sessionId: targetId, blocks });
			useSessionsStore.getState().appendMessage(targetId, {
				id: crypto.randomUUID(),
				role: "user",
				content: {
					type: "user",
					message: { role: "user", content: blocks },
				},
				ts: Date.now(),
			});
			useDraftStore.getState().clearDraft(sessionId);
			if (isDraft) {
				// Navigate BEFORE discardDraft so the DraftSessionChat doesn't
				// briefly render its "Draft no longer exists" fallback. The
				// route swap unmounts the draft view and mounts the real
				// SessionChat for `targetId`. `replace` so the back button
				// doesn't strand the user on the now-dead draft URL.
				navigate(`/sessions/${targetId}`, { replace: true });
				useDraftSessionsStore.getState().discardDraft();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
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
						title="Stop Claude's current response"
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
					<PromptShortcutsButton
						onRun={runPromptShortcut}
						disabled={disabled || sending}
					/>
					{dictating ? (
						<span style={{ fontSize: 11.5, color: T.textFaint }}>
							↵ to finish dictating
						</span>
					) : null}
					<div style={{ flex: 1 }} />
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
					<button
						onClick={send}
						disabled={disabled || sending || !canSend}
						className={`btn ${branchStale ? "btn-destructive" : "btn-primary"}`}
						title={
							branchStale && lastUserMessageBranch
								? `Branch changed since last message (was "${lastUserMessageBranch}")`
								: undefined
						}
						style={isRunning ? { opacity: 0.55, cursor: "default" } : undefined}
					>
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
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * In-session prompt shortcuts menu, living in the composer footer where the
 * keyboard hint used to be.
 *
 * Distinct from the sidebar's ShortcutsButton: that one lists cwd-carrying
 * shortcuts and spawns a *new* draft session. This one appends a saved
 * prompt to the session you're already in. Separate store, separate menu,
 * separate modals.
 *
 * The menu opens UPWARD (`bottom` rather than `top`) because the composer is
 * pinned to the bottom of the window — a downward menu would be clipped.
 */
function PromptShortcutsButton({
	onRun,
	disabled,
}: {
	onRun: (sc: PromptShortcut) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);
	const shortcutsById = usePromptShortcutsStore((s) => s.promptShortcuts);
	const shortcuts = Object.values(shortcutsById).sort((a, b) =>
		promptShortcutLabel(a).localeCompare(promptShortcutLabel(b), undefined, {
			sensitivity: "base",
		}),
	);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				className="btn btn-icon"
				onClick={() => setOpen((o) => !o)}
				disabled={disabled}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Prompt shortcuts"
				style={{ color: open ? T.text : T.textDim }}
			>
				{/* Lightning bolt — the conventional shortcut glyph. */}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path
						d="M7.8 1.5L3.5 7.8h3.1l-.4 4.7 4.3-6.3H7.4l.4-4.7z"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			</button>
			{open ? (
				<div
					role="menu"
					style={{
						position: "absolute",
						bottom: "calc(100% + 4px)",
						left: 0,
						minWidth: 220,
						maxHeight: 280,
						overflowY: "auto",
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 50,
						boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
					}}
				>
					{shortcuts.map((sc) => (
						<PromptMenuItem
							key={sc.id}
							label={promptShortcutLabel(sc)}
							onClick={() => {
								setOpen(false);
								onRun(sc);
							}}
						/>
					))}
					{shortcuts.length > 0 ? (
						<div
							role="separator"
							style={{
								height: 0,
								borderTop: `0.5px solid ${T.borderSoft}`,
								margin: "4px 2px",
							}}
						/>
					) : null}
					<PromptMenuItem
						label="Create prompt shortcut"
						onClick={() => {
							setOpen(false);
							setCreating(true);
						}}
					/>
					{shortcuts.length > 0 ? (
						<PromptMenuItem
							label="Edit prompt shortcuts"
							onClick={() => {
								setOpen(false);
								setEditing(true);
							}}
						/>
					) : null}
				</div>
			) : null}
			<CreatePromptShortcutModal
				open={creating}
				onClose={() => setCreating(false)}
			/>
			<EditPromptShortcutsModal
				open={editing}
				onClose={() => setEditing(false)}
			/>
		</div>
	);
}

/**
 * Menu row for the prompt-shortcuts dropdown. A trimmed re-implementation of
 * SessionsList's private `MenuItem` — that one is buried in a ~2700-line file
 * with sidebar-only affordances (active/danger/checkbox) this menu doesn't
 * need, and extracting it would churn five unrelated call sites.
 */
function PromptMenuItem({
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
