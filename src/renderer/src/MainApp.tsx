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
import { SessionsList } from "./features/claude-sessions/components/SessionsList";
import { SessionChat } from "./features/claude-sessions/components/SessionChat";
import { DiffViewer } from "./features/claude-sessions/components/DiffViewer";
import { InboxSidebar } from "./features/claude-sessions/components/InboxSidebar";
import { NotesSidebarShell } from "./features/claude-sessions/components/notes/NotesSidebarShell";
import { AppNav } from "./features/claude-sessions/components/AppNav";
import { useSettingsStore } from "./features/claude-sessions/stores/useSettingsStore";
import { T } from "./design/tokens";

/**
 * Discriminated state for the right-hand panel. Inbox and Notes share
 * one slot and are mutually exclusive — opening one closes the other.
 * `null` means no right panel is open.
 */
export type RightPanel = "inbox" | "notes" | null;

const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 260;

export default function MainApp() {
	useSessionsBootstrap();
	useNotificationRouter();
	useDockUnreadBadge();
	const [rightPanel, setRightPanel] = useState<RightPanel>(null);
	const [appInfo, setAppInfo] = useState<{
		env: "dev" | "prod";
		storeFolder: string;
	} | null>(null);
	useEffect(() => {
		let alive = true;
		window.claude.getAppInfo().then((info) => {
			if (alive) setAppInfo(info);
		});
		return () => {
			alive = false;
		};
	}, []);
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
			<span
				title="Double-click to toggle DevTools"
				onDoubleClick={() => {
					void window.claude.toggleDevTools();
				}}
				style={{
					position: "fixed",
					left: 6,
					bottom: 4,
					fontSize: 10,
					fontFamily: T.mono,
					color: T.textFaint,
					userSelect: "none",
					zIndex: 1,
					letterSpacing: 0.2,
				}}
			>
				v{__APP_VERSION__}
				{appInfo ? ` · ${appInfo.env} · ${appInfo.storeFolder}` : ""}
			</span>
			<AppNav rightPanel={rightPanel} setRightPanel={setRightPanel} />
			<MainBody rightPanel={rightPanel} setRightPanel={setRightPanel} />
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
	// holds the active session (`/sessions/:id`, `/sessions/:id/diff`) and is
	// empty at the index route `/` — that's the "no session selected" state.
	const sessionMatch = useMatch("/sessions/:id/*");
	const activeSessionId = sessionMatch?.params.id;

	// Auto-close Notes when navigating away from a session route — the panel
	// is session-scoped, so rendering it for an undefined session is wrong.
	useEffect(() => {
		if (rightPanel === "notes" && !activeSessionId) setRightPanel(null);
	}, [rightPanel, activeSessionId, setRightPanel]);

	return (
		<div style={{ flex: 1, display: "flex", minHeight: 0 }}>
			<SessionsListSidebarShell />
			<div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
				<Routes>
					<Route path="/" element={null} />
					<Route path="/sessions/:id" element={<SessionRoute />} />
					<Route path="/sessions/:id/diff" element={<DiffRoute />} />
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
				}}
			>
				<SessionsList activeSessionId={activeSessionId} />
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

function DiffRoute() {
	const { id } = useParams<{ id: string }>();
	return id ? <DiffViewer sessionId={id} /> : null;
}
