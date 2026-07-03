import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDraftSessionsStore } from "../stores/useDraftSessionsStore";
import { useDraftStore } from "../stores/useDraftStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ImagePasteTextarea } from "./ImagePasteTextarea";
import { T } from "../../../design/tokens";

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
			useDraftSessionsStore.getState().updateDraft({ cwd: picked });
			// Match the New Session flow so the next click of the sidebar
			// button pre-fills this folder too.
			useSettingsStore.getState().setLastUsedWorkspace(picked);
		} finally {
			setPickingFolder(false);
		}
	}, [draftId, pickingFolder]);

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
			const empty =
				!textDraft ||
				(textDraft.text.trim() === "" && textDraft.images.length === 0);
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
						<span
							title={draft.title}
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								fontStyle: "italic",
								color: T.textDim,
							}}
						>
							{draft.title}
						</span>
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
							title={`${draft.cwd}\n\nClick to change folder`}
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
				</div>
			</div>

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
