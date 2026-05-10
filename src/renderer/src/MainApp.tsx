import { useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { useSessionsBootstrap } from "./features/claude-sessions/hooks/useSessionsBootstrap";
import { useNotificationRouter } from "./features/claude-sessions/hooks/useNotificationRouter";
import { useDockUnreadBadge } from "./features/claude-sessions/hooks/useDockUnreadBadge";
import { SessionsList } from "./features/claude-sessions/components/SessionsList";
import { SessionChat } from "./features/claude-sessions/components/SessionChat";
import { DiffViewer } from "./features/claude-sessions/components/DiffViewer";
import { InboxSidebar } from "./features/claude-sessions/components/InboxSidebar";
import { AppNav } from "./features/claude-sessions/components/AppNav";
import { T } from "./design/tokens";

export default function MainApp() {
	useSessionsBootstrap();
	useNotificationRouter();
	useDockUnreadBadge();
	const [inboxOpen, setInboxOpen] = useState(true);
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
			<AppNav
				inboxOpen={inboxOpen}
				onToggleInbox={() => setInboxOpen((v) => !v)}
			/>
			<div style={{ flex: 1, display: "flex", minHeight: 0 }}>
				<div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
					<Routes>
						<Route path="/" element={<SessionsList />} />
						<Route path="/sessions/:id" element={<SessionRoute />} />
						<Route path="/sessions/:id/diff" element={<DiffRoute />} />
					</Routes>
				</div>
				{inboxOpen ? (
					<InboxSidebar onClose={() => setInboxOpen(false)} />
				) : null}
			</div>
		</div>
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
