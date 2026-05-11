import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { SessionNotesPanel } from "./SessionNotesPanel";
import { T } from "../../../../design/tokens";

const NOTES_DEFAULT_WIDTH = 380;
const NOTES_MIN_WIDTH = 280;

/**
 * Owns the resize handle + persisted width for the right notes panel.
 * Mirrors `SessionsListSidebarShell` in MainApp.tsx exactly, with the
 * pointer-delta sign flipped (handle is on the LEFT edge of the panel,
 * so dragging left should *grow* the panel).
 *
 * Width is persisted in `app_settings.json` as `notesSidebarWidth` via
 * `useSettingsStore`. Single IPC write per drag (on pointer-up).
 */
export function NotesSidebarShell({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const persistedWidth = useSettingsStore((s) => s.notesSidebarWidth);
	const setPersistedWidth = useSettingsStore((s) => s.setNotesSidebarWidth);
	const [width, setWidth] = useState<number>(
		persistedWidth ?? NOTES_DEFAULT_WIDTH,
	);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	// Once the persisted value hydrates from IPC (undefined -> number),
	// adopt it. Skip while dragging so we don't clobber the live value.
	// `width` is intentionally NOT a dep — including it would re-run on
	// every drag tick and fight the local state.
	useEffect(() => {
		if (dragRef.current) return;
		if (persistedWidth !== undefined && persistedWidth !== width) {
			setWidth(persistedWidth);
		}
	}, [persistedWidth]);

	const computeMax = () =>
		Math.min(720, Math.floor(window.innerWidth * 0.6));

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		e.currentTarget.setPointerCapture(e.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ew-resize";
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		const max = computeMax();
		// Flip sign vs left-sidebar: dragging the handle LEFT (negative
		// delta) should grow the panel; dragging right shrinks it.
		// Round to int — clientX is fractional on high-DPI displays, and we
		// persist this value through a Zod `int()` schema on pointer-up.
		const next = Math.round(
			Math.min(
				max,
				Math.max(NOTES_MIN_WIDTH, d.startWidth - (e.clientX - d.startX)),
			),
		);
		setWidth(next);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
		setPersistedWidth(width);
	};

	return (
		<aside
			style={{
				width,
				flexShrink: 0,
				height: "100%",
				display: "flex",
				flexDirection: "row",
				background: T.win,
			}}
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize notes panel"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				style={{
					width: 6,
					flexShrink: 0,
					cursor: "ew-resize",
					touchAction: "none",
					display: "flex",
					justifyContent: "center",
				}}
			>
				<div
					style={{
						width: 1,
						height: "100%",
						background: T.borderSoft,
					}}
				/>
			</div>
			<SessionNotesPanel sessionId={sessionId} onClose={onClose} />
		</aside>
	);
}
