import {
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { Route, Routes, useMatch, useParams } from "react-router-dom";
import { useSessionsBootstrap } from "./features/claude-sessions/hooks/useSessionsBootstrap";
import { useNotificationRouter } from "./features/claude-sessions/hooks/useNotificationRouter";
import { useDockUnreadBadge } from "./features/claude-sessions/hooks/useDockUnreadBadge";
import { useQueuedMessageFlusher } from "./features/claude-sessions/hooks/useQueuedMessageFlusher";
import { useUpdater } from "./features/updater/hooks/useUpdater";
import { UpdateModal } from "./features/updater/components/UpdateModal";
import { BackgroundTasksIndicator } from "./features/background-tasks/components/BackgroundTasksIndicator";
import { SessionsList } from "./features/claude-sessions/components/SessionsList";
import { SessionChat } from "./features/claude-sessions/components/SessionChat";
import { InboxSidebar } from "./features/claude-sessions/components/InboxSidebar";
import { NotesSidebarShell } from "./features/claude-sessions/components/notes/NotesSidebarShell";
import { SidequestSidebarShell } from "./features/claude-sessions/components/sidequest/SidequestSidebarShell";
import { AppNav } from "./features/claude-sessions/components/AppNav";
import { SidebarFooter } from "./features/claude-sessions/components/SidebarFooter";
import { useSettingsStore } from "./features/claude-sessions/stores/useSettingsStore";
import {
	useRightPanelStore,
	type RightPanel,
} from "./features/claude-sessions/stores/useRightPanelStore";
import { useSidequestHotkey } from "./features/claude-sessions/hooks/useSidequestHotkey";
import { useComposerFocusHotkey } from "./features/claude-sessions/hooks/useComposerFocusHotkey";
import { T } from "./design/tokens";

// Re-exported for the components that already import the type from here.
// The state itself now lives in `useRightPanelStore` so the global Cmd+S
// handler can open the sidequest panel from outside the component tree.
export type { RightPanel };

const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 260;

export default function MainApp() {
	useSessionsBootstrap();
	useNotificationRouter();
	useDockUnreadBadge();
	useUpdater();
	// Fires a session's queued pre-move the instant its turn is completely
	// done. Mounted app-level (not inside the composer) so a queue still
	// fires after navigating away from the session that queued it.
	useQueuedMessageFlusher();
	// Global ⌘S — opens/creates the sidequest panel. Mounted once, here.
	useSidequestHotkey();
	// Global ⌘R — focuses the main composer, quoting any highlighted
	// selection inline. Mounted once, here.
	useComposerFocusHotkey();
	const rightPanel = useRightPanelStore((s) => s.rightPanel);
	const setRightPanel = useRightPanelStore((s) => s.setRightPanel);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				background: T.win,
				color: T.text,
				fontFamily: T.sans,
			}}
		>
			{/* The version chip + rate-limit meter now live inside
			    `SidebarFooter`, pinned to the bottom of the sessions sidebar
			    rather than floating fixed over the window corner. */}
			<AppNav rightPanel={rightPanel} setRightPanel={setRightPanel} />
			<MainBody rightPanel={rightPanel} setRightPanel={setRightPanel} />
			<UpdateModal />
			{/* Ambient bottom-right chip for fire-and-forget work (worktree
			    deletion today). Self-hides when nothing is running. */}
			<BackgroundTasksIndicator />
		</div>
	);
}

function MainBody({
	rightPanel,
	setRightPanel,
}: {
	rightPanel: RightPanel;
	setRightPanel: (v: RightPanel) => void;
}) {
	// The SessionsList sidebar is always rendered on the left. The right pane
	// holds the active session (`/sessions/:id`) and is empty at the index
	// route `/` — that's the "no session selected" state.
	const sessionMatch = useMatch("/sessions/:id/*");
	const activeSessionId = sessionMatch?.params.id;

	// Auto-close the session-scoped panels when navigating away from a session
	// route — rendering them for an undefined session is wrong. (The sidequest
	// itself survives: it's keyed by parent session id in useSidequestsStore,
	// so returning to the session brings its transcript back.)
	useEffect(() => {
		if (
			(rightPanel === "notes" || rightPanel === "sidequest") &&
			!activeSessionId
		) {
			setRightPanel(null);
		}
	}, [rightPanel, activeSessionId, setRightPanel]);

	return (
		<div style={{ flex: 1, display: "flex", minHeight: 0 }}>
			<SessionsListSidebarShell />
			<div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
				<Routes>
					<Route path="/" element={null} />
					<Route path="/sessions/:id" element={<SessionRoute />} />
				</Routes>
			</div>
			{rightPanel === "inbox" ? (
				<InboxSidebar onClose={() => setRightPanel(null)} />
			) : null}
			{rightPanel === "notes" && activeSessionId ? (
				<NotesSidebarShell
					sessionId={activeSessionId}
					onClose={() => setRightPanel(null)}
				/>
			) : null}
			{rightPanel === "sidequest" && activeSessionId ? (
				<SidequestSidebarShell
					sessionId={activeSessionId}
					onClose={() => setRightPanel(null)}
				/>
			) : null}
		</div>
	);
}

/**
 * Owns the left-sidebar pane width and the drag-to-resize handle. Mirrors the
 * pointer-event pattern in SessionChat (input-divider) but horizontal. Width
 * is persisted across reloads in useSettingsStore (single IPC write per drag).
 */
function SessionsListSidebarShell() {
	const match = useMatch("/sessions/:id/*");
	const activeSessionId = match?.params.id;
	const persistedWidth = useSettingsStore((s) => s.sessionsSidebarWidth);
	const setPersistedWidth = useSettingsStore(
		(s) => s.setSessionsSidebarWidth,
	);
	const [width, setWidth] = useState<number>(
		persistedWidth ?? SIDEBAR_DEFAULT_WIDTH,
	);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	// Once the persisted value hydrates from IPC (undefined -> number), adopt
	// it. Skip while a drag is in progress so we don't clobber the live value.
	// `width` is intentionally NOT a dep — including it would re-run on every
	// drag tick and fight the local state.
	useEffect(() => {
		if (dragRef.current) return;
		if (persistedWidth !== undefined && persistedWidth !== width) {
			setWidth(persistedWidth);
		}
	}, [persistedWidth]);

	const computeMax = () =>
		Math.min(560, Math.floor(window.innerWidth * 0.5));

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
		// Round to int — clientX is fractional on high-DPI displays, and we
		// persist this value through a Zod `int()` schema on pointer-up.
		const next = Math.round(
			Math.min(
				max,
				Math.max(SIDEBAR_MIN_WIDTH, d.startWidth + (e.clientX - d.startX)),
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
		// Single IPC write per drag (no-op if value unchanged).
		setPersistedWidth(width);
	};

	return (
		<>
			<div
				style={{
					width,
					flexShrink: 0,
					height: "100%",
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
					background: T.win,
					// Positioning context for `SidebarFooter`, which anchors itself
					// `position: absolute` to the bottom of this pane.
					position: "relative",
				}}
			>
				<SessionsList activeSessionId={activeSessionId} />
				<SidebarFooter />
			</div>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize sessions sidebar"
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
		</>
	);
}

function SessionRoute() {
	const { id } = useParams<{ id: string }>();
	return id ? <SessionChat sessionId={id} /> : null;
}
