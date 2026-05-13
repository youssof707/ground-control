import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Note } from "@shared/schemas/session_notes";
import { useSessionNotesStore } from "../../stores/useSessionNotesStore";
import { MarkdownText } from "../MarkdownText";
import { NoteEditor } from "./NoteEditor";
import { T } from "../../../../design/tokens";

const CONFIRM_REVERT_MS = 3000;

/**
 * One note in the panel with explicit view/edit modes:
 *
 *   • View mode (default): renders the note's markdown directly into the
 *     card (no inner textbox border). Toolbar shows pencil (edit) +
 *     trash (delete with two-step confirm).
 *
 *   • Edit mode: mounts the TipTap editor with its own boxed surface.
 *     Toolbar shows checkmark (commit + exit) + X (cancel without
 *     saving). Auto-saves on editor blur — clicking outside the card
 *     commits the edit. Pressing X on mousedown prevents the editor's
 *     blur from firing so cancel actually discards changes.
 *
 * Freshly-created notes (createdAt within 2s) enter edit mode
 * automatically and autofocus their editor.
 */
export function NoteCard({ note }: { note: Note }) {
	const updateNote = useSessionNotesStore((s) => s.updateNote);
	const deleteNote = useSessionNotesStore((s) => s.deleteNote);

	const [editing, setEditing] = useState<boolean>(
		Date.now() - note.createdAt < 2000,
	);
	const noteIdRef = useRef(note.id);
	noteIdRef.current = note.id;
	const noteMarkdownRef = useRef(note.markdown);
	noteMarkdownRef.current = note.markdown;

	// Latest markdown emitted by the editor. Null when no edit is pending
	// (either we're in view mode, or the editor hasn't fired onChange yet).
	const pendingMarkdownRef = useRef<string | null>(null);
	// Editor's flush-getter — pulls the live markdown out of TipTap without
	// waiting for the next onUpdate tick. Used when committing on unmount.
	const flushGetterRef = useRef<(() => string | null) | null>(null);
	// Set when the user clicks the X (cancel) so the editor's onBlur, which
	// fires synchronously before onClick, doesn't accidentally save.
	const cancelingRef = useRef(false);

	const commitAndExit = (markdown: string | null) => {
		const text = markdown ?? pendingMarkdownRef.current;
		if (text !== null && text !== noteMarkdownRef.current) {
			void updateNote(noteIdRef.current, text);
		}
		pendingMarkdownRef.current = null;
		setEditing(false);
	};

	const cancelAndExit = () => {
		pendingMarkdownRef.current = null;
		setEditing(false);
	};

	// If the user closes the panel (or otherwise unmounts the card) while
	// the editor is open and dirty, commit the pending edit. Cancel takes
	// the same path but clears pendingMarkdownRef first, so the diff check
	// is a no-op.
	useEffect(() => {
		return () => {
			if (cancelingRef.current) return;
			const live = flushGetterRef.current?.() ?? null;
			const text = live ?? pendingMarkdownRef.current;
			if (text !== null && text !== noteMarkdownRef.current) {
				void updateNote(noteIdRef.current, text);
			}
		};
	}, [updateNote]);

	// Two-step delete confirm — preserved verbatim from the previous design.
	const [confirming, setConfirming] = useState(false);
	const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		return () => {
			if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
		};
	}, []);
	const onDeleteClick = () => {
		if (!confirming) {
			setConfirming(true);
			confirmTimerRef.current = setTimeout(() => {
				setConfirming(false);
				confirmTimerRef.current = null;
			}, CONFIRM_REVERT_MS);
			return;
		}
		if (confirmTimerRef.current) {
			clearTimeout(confirmTimerRef.current);
			confirmTimerRef.current = null;
		}
		pendingMarkdownRef.current = null;
		cancelingRef.current = true;
		void deleteNote(note.id);
	};

	// Cancel button: preventDefault on mousedown so the editor doesn't
	// blur (which would otherwise trigger a save through onEditorBlur).
	const onCancelMouseDown = (e: ReactMouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
	};
	const onCancelClick = () => {
		cancelingRef.current = true;
		cancelAndExit();
		// Re-arm in case the user re-enters edit mode later.
		queueMicrotask(() => {
			cancelingRef.current = false;
		});
	};

	const onEditClick = () => {
		setEditing(true);
	};

	const onSaveClick = () => {
		// The editor's onBlur fires before onClick on the save button, so
		// the actual commit usually happens there. Still call commit here
		// for the (rare) case where the editor isn't focused.
		const live = flushGetterRef.current?.() ?? null;
		commitAndExit(live);
	};

	const onEditorChange = (markdown: string) => {
		pendingMarkdownRef.current = markdown;
	};

	const onEditorBlur = (markdown: string) => {
		// Skip the save path if the user is actively canceling — the X
		// button sets this flag before this fires.
		if (cancelingRef.current) return;
		commitAndExit(markdown);
	};

	return (
		<div
			style={{
				borderRadius: 12,
				background: T.surface,
				border: `0.5px solid ${T.border}`,
				padding: "6px 10px 10px",
				// Flex children default to min-width: auto, which means a single
				// long unbreakable token inside the editor (a URL, a JSON line)
				// can size this card past its parent's width and trigger a
				// horizontal scrollbar on the notes scroll container. Forcing
				// min-width: 0 makes the card respect the parent column width,
				// which in turn lets `overflow-wrap: anywhere` actually fire on
				// the editor content inside.
				minWidth: 0,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: 8,
					height: 26,
					marginBottom: 4,
				}}
			>
				<span
					style={{
						fontSize: 11.5,
						color: T.textFaint,
						fontFamily: T.sans,
						letterSpacing: 0.1,
						userSelect: "none",
					}}
				>
					{formatNoteDate(note.updatedAt)}
				</span>
				<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
					{editing ? (
						<>
							<IconButton
								onClick={onSaveClick}
								ariaLabel="Save note"
								title="Save"
							>
								<CheckIcon />
							</IconButton>
							<IconButton
								onMouseDown={onCancelMouseDown}
								onClick={onCancelClick}
								ariaLabel="Cancel edit"
								title="Cancel"
							>
								<XIcon />
							</IconButton>
						</>
					) : (
						<>
							<IconButton
								onClick={onEditClick}
								ariaLabel="Edit note"
								title="Edit"
							>
								<PencilIcon />
							</IconButton>
							{confirming ? (
								<button
									type="button"
									onClick={onDeleteClick}
									aria-label="Confirm delete note"
									style={{
										padding: "4px 10px",
										borderRadius: 6,
										border: `0.5px solid ${T.dangerBorder}`,
										background: T.dangerSoft,
										color: T.danger,
										fontSize: 11.5,
										fontWeight: 500,
										fontFamily: T.sans,
										lineHeight: 1.2,
										cursor: "pointer",
									}}
								>
									Confirm delete?
								</button>
							) : (
								<IconButton
									onClick={onDeleteClick}
									ariaLabel="Delete note"
									title="Delete"
								>
									<TrashIcon />
								</IconButton>
							)}
						</>
					)}
				</div>
			</div>

			{editing ? (
				<NoteEditor
					initialMarkdown={note.markdown}
					onChange={onEditorChange}
					onBlur={onEditorBlur}
					onFlushNeededRef={flushGetterRef}
					autoFocus
				/>
			) : (
				<NoteViewer markdown={note.markdown} onActivate={onEditClick} />
			)}
		</div>
	);
}

/**
 * Format: "1-May-2023" — day without leading zero, short month name,
 * 4-digit year. Used in the top-left of each note card.
 */
function formatNoteDate(ts: number): string {
	const d = new Date(ts);
	const day = d.getDate();
	const month = d.toLocaleString("en-US", { month: "short" });
	const year = d.getFullYear();
	return `${day}-${month}-${year}`;
}

/**
 * Read-only view. Clicking anywhere on the rendered markdown enters
 * edit mode — matches the "tap to edit" affordance the user expects
 * after seeing the pencil icon. Empty notes show a muted placeholder.
 */
function NoteViewer({
	markdown,
	onActivate,
}: {
	markdown: string;
	onActivate: () => void;
}) {
	const hasContent = markdown.trim().length > 0;
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onActivate}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onActivate();
				}
			}}
			style={{ cursor: "text" }}
		>
			{hasContent ? (
				<MarkdownText text={markdown} />
			) : (
				<div style={{ color: T.textFaint, fontSize: 13, fontStyle: "italic" }}>
					Empty note — click to edit.
				</div>
			)}
		</div>
	);
}

function IconButton({
	children,
	onClick,
	onMouseDown,
	ariaLabel,
	title,
}: {
	children: React.ReactNode;
	onClick: () => void;
	onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
	ariaLabel: string;
	title: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseDown={onMouseDown}
			aria-label={ariaLabel}
			title={title}
			style={{
				width: 24,
				height: 24,
				padding: 0,
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.textMute,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
			}}
		>
			{children}
		</button>
	);
}

function PencilIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<path
				d="M9.5 2.5l2 2L4.5 11.5H2.5V9.5l7-7z"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<path
				d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M6 6v4M8 6v4"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<path
				d="M3 7.5l2.5 2.5L11 4"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function XIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<path
				d="M3.5 3.5l7 7M10.5 3.5l-7 7"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
		</svg>
	);
}
