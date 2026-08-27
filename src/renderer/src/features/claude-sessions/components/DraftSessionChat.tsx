import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { AttachWorktreeModal } from "./AttachWorktreeModal";
import { ModelPickerModal } from "./ModelPickerModal";
import { WorktreeChip } from "../../../design/WorktreeChip";
import { T } from "../../../design/tokens";
import { formatModelName } from "@shared/claude-sessions/sessionModel";

/**
 * Right-pane view for a draft session — one that exists only in the renderer
 * until the user sends a first message. Sibling to `SessionChat` but stripped
 * down: there is no transcript yet, no fork / rename / permission affordances,
 * no branch chip, no Stop button, no token bar. Just a header showing the
 * provisional title + cwd, an empty-state message, and the existing
 * `ImagePasteTextarea` (which becomes draft-aware via its `sessionId` prop —
 * `useDraftStore` already keys text + images by id).
 *
 * On unmount we auto-discard the draft iff it's empty (no text, no images),
 * per product decision. The actual draft → real session promotion lives in
 * `ImagePasteTextarea.send` so we don't need to thread the IPC through here.
 */
export function DraftSessionChat({ draftId }: { draftId: string }) {
	const draft = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === draftId ? s.draft : null,
	);
	const [inputHeight, setInputHeight] = useState(44);
	const maxInputHeight = Math.max(120, Math.floor(window.innerHeight * 0.45));
	// Guard against double-clicks on the folder chip spawning two pickers.
	// The native dialog is modal but the async round-trip leaves a window.
	const [pickingFolder, setPickingFolder] = useState(false);
	const [folderHover, setFolderHover] = useState(false);
	// Worktree modal state — opens on "Add worktree" button click.
	const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);
	// Model picker modal state — opens on the model chip click.
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	// Whether the draft's cwd is a git repo. Determines whether the
	// "Add worktree" button is visible at all — worktrees are a git
	// concept, so we hide the affordance entirely for non-git folders
	// rather than showing it disabled. Refetched whenever cwd changes.
	const [isGitRepo, setIsGitRepo] = useState<boolean>(false);
	// Selector on the worktrees store so the chip updates immediately
	// when another window creates/deletes worktrees. undefined when the
	// draft has no worktree attached.
	const attachedWorktree = useWorktreesStore((s) =>
		draft?.worktreeId ? s.worktrees[draft.worktreeId] : undefined,
	);

	// Change the draft's cwd via the native picker. Only reachable while the
	// session is still a draft — once promoted to a real session by the first
	// send, the header comes from `SessionChat`, which has no such affordance
	// (cwd is immutable post-creation).
	const changeFolder = useCallback(async () => {
		if (pickingFolder) return;
		const current = useDraftSessionsStore.getState().draft;
		if (!current || current.id !== draftId) return;
		setPickingFolder(true);
		try {
			const picked = await window.claude.pickFolder({
				defaultPath: current.cwd,
			});
			if (!picked) return;
			// Re-check the draft is still ours — the dialog was async, the
			// user could have discarded / promoted / navigated in the interim.
			const stillOurs = useDraftSessionsStore.getState().draft;
			if (!stillOurs || stillOurs.id !== draftId) return;
			// Clear any attached worktree along with the cwd change: a worktree
			// is bound to a specific baseDir, so changing folder invalidates
			// the pairing. The user can attach a new one (or an existing one
			// matching the new baseDir) after the change.
			useDraftSessionsStore
				.getState()
				.updateDraft({ cwd: picked, worktreeId: undefined });
			// Match the New Session flow so the next click of the sidebar
			// button pre-fills this folder too.
			useSettingsStore.getState().setLastUsedWorkspace(picked);
		} finally {
			setPickingFolder(false);
		}
	}, [draftId, pickingFolder]);

	// Reprobe git-repo status when the draft's cwd changes. Gates the
	// "Add worktree" button — we hide it entirely for non-git folders
	// rather than showing it disabled. Cheap probe: single `git rev-parse`
	// via IPC. Sequence-guarded so a fast folder-change doesn't leave us
	// with a stale answer.
	useEffect(() => {
		const cwd = draft?.cwd;
		if (!cwd) {
			setIsGitRepo(false);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const ok = await window.claude.isGitRepo(cwd);
				if (!cancelled) setIsGitRepo(ok);
			} catch {
				if (!cancelled) setIsGitRepo(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [draft?.cwd]);

	// Mirror SessionChat's auto-grow rule but skip the manual drag-shrink lock
	// since we don't render the resize divider here. The textarea reports its
	// natural scrollHeight; we push the rendered height up to fit, never down.
	const onContentHeightChange = useCallback(
		(sh: number) => {
			setInputHeight((prev) =>
				sh > prev ? Math.min(maxInputHeight, Math.max(44, sh)) : prev,
			);
		},
		[maxInputHeight],
	);

	// Auto-discard on unmount iff the draft is empty AND the user has
	// actually navigated away from this draft's URL. The URL check rejects
	// spurious "unmounts" — React StrictMode double-invokes effects on
	// initial mount in dev (and HMR can trigger similar remounts), which
	// would otherwise wipe a freshly created (by definition empty) draft
	// before the user could even type. Genuine navigation cases still
	// fire correctly:
	//   - navigating to another session/route (URL changed → discard runs)
	//   - explicit Discard from the sidebar (no-op: draft is already null)
	//   - successful first send → navigate to real session (URL changed,
	//     but draft was already discarded by the send handler; the id
	//     check below short-circuits)
	useEffect(() => {
		return () => {
			// Ground truth that the user is still on this draft: the hash
			// route. The app uses HashRouter, so the location looks like
			// `#/sessions/<id>`. If we still match, this unmount is spurious.
			if (window.location.hash === `#/sessions/${draftId}`) return;
			const current = useDraftSessionsStore.getState().draft;
			if (!current || current.id !== draftId) return;
			const textDraft = useDraftStore.getState().draftsBySession[draftId];
			// A typed-but-unsent session name counts as intent too — discarding
			// it silently on navigate-away would be surprising.
			const empty =
				current.title.trim() === "" &&
				(!textDraft ||
					(textDraft.text.trim() === "" && textDraft.images.length === 0));
			if (empty) {
				useDraftStore.getState().clearDraft(draftId);
				useDraftSessionsStore.getState().discardDraft();
			}
		};
	}, [draftId]);

	if (!draft) {
		return (
			<div className="page">
				<div className="message">
					Draft no longer exists.{" "}
					<Link to="/" style={{ color: T.accent }}>
						Back to sessions
					</Link>
					.
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				background: T.win,
			}}
		>
			{/* Breadcrumb header — title (italic) + Draft pill + cwd folder */}
			<div
				style={{
					flexShrink: 0,
					borderBottom: `0.5px solid ${T.border}`,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					padding: "10px 18px",
					background: T.win,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 14,
						minWidth: 0,
					}}
				>
					<div
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							fontSize: 14,
							fontWeight: 600,
							color: T.text,
							maxWidth: 360,
							flexShrink: 0,
							minWidth: 0,
						}}
					>
						{/* Always-editable name box (no click-to-edit step — naming
						    the session is a first-class part of composing it).
						    Leaving it blank keeps the old behaviour: the session
						    is created with the provisional `Session N` title and
						    the main process derives a real one from the first
						    message. Typing a name locks it permanently.

						    Writes to the store on every keystroke rather than on
						    blur — `send()` in ImagePasteTextarea reads the draft
						    synchronously, so an on-blur-only write would lose the
						    name when the user types it and then hits Enter in the
						    composer without ever leaving this field. */}
						<input
							value={draft.title}
							onChange={(e) =>
								useDraftSessionsStore
									.getState()
									.updateDraft({ title: e.target.value })
							}
							onKeyDown={(e) => {
								// Neither key submits anything — sending is the
								// composer's job. Both just release focus.
								if (e.key === "Enter" || e.key === "Escape") {
									e.preventDefault();
									e.currentTarget.blur();
								}
							}}
							placeholder="Session name"
							// Matches the `session:rename` IPC handler's cap, so
							// both naming paths truncate identically.
							maxLength={200}
							spellCheck={false}
							aria-label="Session name"
							style={{
								// Chromeless at rest so it reads as the title, not a
								// form field; surface + border appear on hover/focus.
								appearance: "none",
								border: "0.5px solid transparent",
								borderRadius: 6,
								background: "transparent",
								padding: "2px 6px",
								margin: "-2px -6px",
								outline: "none",
								// Inputs can't hug their content; the parent caps at
								// maxWidth 360 and the Draft pill sits alongside.
								width: 210,
								minWidth: 0,
								fontFamily: "inherit",
								fontSize: 14,
								fontWeight: 600,
								fontStyle: "italic",
								// index.css sets a global `input { color: … }` that
								// would otherwise beat the dim treatment.
								color: T.textDim,
								textOverflow: "ellipsis",
								transition: "background 80ms ease, border-color 80ms ease",
							}}
							onFocus={(e) => {
								e.currentTarget.style.background = T.surface;
								e.currentTarget.style.borderColor = T.border;
								e.currentTarget.style.color = T.text;
							}}
							onBlur={(e) => {
								e.currentTarget.style.background = "transparent";
								e.currentTarget.style.borderColor = "transparent";
								e.currentTarget.style.color = T.textDim;
							}}
							onMouseEnter={(e) => {
								if (document.activeElement !== e.currentTarget)
									e.currentTarget.style.background = T.surfaceLow;
							}}
							onMouseLeave={(e) => {
								if (document.activeElement !== e.currentTarget)
									e.currentTarget.style.background = "transparent";
							}}
						/>
						<DraftPill />
					</div>
					{/* Flex slot fills the row and clips the button to the
					    available width, but the button itself hugs its own
					    content — so the hover highlight stops at the text +
					    pencil, not the full row. `minWidth: 0` lets the
					    button's internal truncation kick in. */}
					<div
						style={{
							flex: 1,
							minWidth: 0,
							display: "flex",
							alignItems: "center",
						}}
					>
						<button
							type="button"
							onClick={changeFolder}
							onMouseEnter={() => setFolderHover(true)}
							onMouseLeave={() => setFolderHover(false)}
							disabled={pickingFolder}
							aria-label={`${draft.cwd} — click to change folder`}
							style={{
								// Reset native button chrome.
								appearance: "none",
								border: "none",
								// Hug content, but never exceed the flex slot
								// so long paths still truncate cleanly.
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								maxWidth: "100%",
								minWidth: 0,
								padding: "2px 6px",
								margin: "-2px -6px",
								borderRadius: 4,
								background: folderHover
									? T.surfaceHi
									: T.surfaceLow,
								cursor: pickingFolder ? "wait" : "pointer",
								fontFamily: T.mono,
								fontSize: 11.5,
								// Default is already brighter than the old
								// static label (textDim vs textFaint) so the
								// affordance reads as interactive at rest.
								color: folderHover ? T.text : T.textDim,
								textAlign: "left",
								transition:
									"background 80ms ease, color 80ms ease",
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
								{folderName(draft.cwd)}
							</span>
							<PencilIcon
								color={folderHover ? T.accent : T.textMute}
							/>
						</button>
					</div>
					{/* Worktree slot: chip when attached, "Add worktree" button
					    when not — but only for git repos (the affordance
					    doesn't apply otherwise). Sits at the right of the
					    header row; sized to hug content so it doesn't push
					    the folder-path column around. */}
					{draft.worktreeId && attachedWorktree ? (
						<WorktreeChip
							displayName={attachedWorktree.displayName}
							color={attachedWorktree.color}
							variant="interactive"
							onDetach={() =>
								useDraftSessionsStore
									.getState()
									.updateDraft({ worktreeId: undefined })
							}
						/>
					) : isGitRepo ? (
						<AddWorktreeButton
							onClick={() => setWorktreeModalOpen(true)}
						/>
					) : null}
				</div>
			</div>

			<AttachWorktreeModal
				open={worktreeModalOpen}
				baseDir={draft.cwd}
				onAttach={(id) =>
					useDraftSessionsStore
						.getState()
						.updateDraft({ worktreeId: id })
				}
				onClose={() => setWorktreeModalOpen(false)}
			/>

			{/* Empty body — placeholder until the first send creates the session. */}
			<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
				<div
					style={{
						height: "100%",
						overflow: "auto",
						padding: "28px 32px 14px",
					}}
				>
					<div style={{ maxWidth: 760, margin: "0 auto" }}>
						<div
							className="message"
							style={{
								textAlign: "center",
								color: T.textFaint,
							}}
						>
							Your first message will create this session.
						</div>
					</div>
				</div>
			</div>

			{/* Static analogue of SessionChat's resize-divider row: draws the
			    same 1px separator above the model bar so the draft footer's
			    visual chrome matches a real session. No pointer handlers —
			    there's no transcript to resize yet. */}
			<div
				style={{
					flexShrink: 0,
					height: 6,
					display: "flex",
					alignItems: "center",
				}}
				aria-hidden="true"
			>
				<div
					style={{ height: 1, width: "100%", background: T.borderSoft }}
				/>
			</div>

			<DraftModelBar
				model={draft.model}
				onOpen={() => setModelPickerOpen(true)}
			/>

			<ModelPickerModal
				open={modelPickerOpen}
				sessionId={draftId}
				effectiveModel={draft.model}
				onSelect={(value) =>
					useDraftSessionsStore.getState().updateDraft({ model: value })
				}
				onClose={() => setModelPickerOpen(false)}
			/>

			<ImagePasteTextarea
				sessionId={draftId}
				textareaHeight={inputHeight}
				onContentHeightChange={onContentHeightChange}
			/>
		</div>
	);
}

// Small pencil glyph matching the stroke-based icon style used elsewhere
// (see the `+` icon on the New Session button in SessionsList). Sized at
// 11px so it sits comfortably next to the 11.5px mono folder name without
// crowding the row.
function PencilIcon({ color }: { color: string }) {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 12 12"
			fill="none"
			aria-hidden="true"
			style={{ flexShrink: 0, transition: "color 80ms ease" }}
		>
			<path
				d="M2.5 9.5V7.5L7.5 2.5L9.5 4.5L4.5 9.5H2.5Z"
				stroke={color}
				strokeWidth="1.2"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
			<path
				d="M6.5 3.5L8.5 5.5"
				stroke={color}
				strokeWidth="1.2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function DraftPill() {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: 18,
				padding: "0 7px",
				borderRadius: 9,
				border: `0.5px solid ${T.border}`,
				background: T.surface,
				color: T.textMute,
				fontSize: 10.5,
				fontWeight: 600,
				letterSpacing: 0.5,
				textTransform: "uppercase",
				fontStyle: "normal",
				flexShrink: 0,
			}}
		>
			Draft
		</span>
	);
}

function folderName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const idx = trimmed.lastIndexOf("/");
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// Ghost pill styled to sit next to WorktreeChip's readonly variant so the
// header row reads consistently whether or not one is attached. Only
// rendered when the draft's cwd is a git repo.
//
// Hover follows the neutral "chip" pattern shared with the folder-picker
// button next to it (surfaceHi bg + full-strength text). The dashed border
// is kept as the "add / not yet attached" affordance — we don't want to
// borrow the info-accent palette on hover because that reads as a
// selection state, not an "invite to click."
// Draft-analogue of SessionTokenBar. Same shell + same clickable-label
// styling, just without the token count (a draft has no messages yet).
// Sits between the empty body and the input textarea so the model chip
// lives in exactly the same on-screen spot it will occupy once the draft
// is promoted to a real session.
function DraftModelBar({
	model,
	onOpen,
}: {
	model: string | undefined;
	onOpen: () => void;
}) {
	const [hover, setHover] = useState(false);
	const label = model ? formatModelName(model) : "Default";
	return (
		<div
			style={{
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				gap: 16,
				padding: "4px 32px 6px",
				fontSize: 11,
				fontFamily: T.mono,
				color: T.textMute,
				background: T.win,
				userSelect: "none",
			}}
		>
			<div
				style={{
					maxWidth: 760,
					margin: "0 auto",
					width: "100%",
					display: "flex",
					alignItems: "center",
				}}
			>
				<button
					onClick={onOpen}
					onMouseEnter={() => setHover(true)}
					onMouseLeave={() => setHover(false)}
					style={{
						padding: 0,
						border: "none",
						background: "none",
						font: "inherit",
						color: hover ? T.text : T.textDim,
						textDecoration: hover ? "underline" : "none",
						textUnderlineOffset: 3,
						cursor: "pointer",
					}}
				>
					{label}
				</button>
			</div>
		</div>
	);
}

function AddWorktreeButton({ onClick }: { onClick: () => void }) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				appearance: "none",
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				border: `0.5px dashed ${hover ? T.border : T.borderSoft}`,
				background: hover ? T.surfaceHi : "transparent",
				color: hover ? T.text : T.textDim,
				fontSize: 11.5,
				fontWeight: 500,
				cursor: "pointer",
				whiteSpace: "nowrap",
				flexShrink: 0,
				transition:
					"background 80ms ease, color 80ms ease, border-color 80ms ease",
			}}
		>
			<svg
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M5 1.5v7M1.5 5h7"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			</svg>
			<span>Add worktree</span>
		</button>
	);
}
