import { Route, Routes, useParams } from "react-router-dom";
import { useSessionsBootstrap } from "./features/claude-sessions/hooks/useSessionsBootstrap";
import { useNotificationRouter } from "./features/claude-sessions/hooks/useNotificationRouter";
import { SessionsList } from "./features/claude-sessions/components/SessionsList";
import { SessionChat } from "./features/claude-sessions/components/SessionChat";
import { DiffViewer } from "./features/claude-sessions/components/DiffViewer";
import { InboxPage } from "./features/claude-sessions/components/InboxPage";
import { AppNav } from "./features/claude-sessions/components/AppNav";
import { T } from "./design/tokens";

export default function MainApp() {
	useSessionsBootstrap();
	useNotificationRouter();
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
			<AppNav />
			<div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
				<Routes>
					<Route path="/" element={<SessionsList />} />
					<Route path="/inbox" element={<InboxPage />} />
					<Route path="/sessions/:id" element={<SessionRoute />} />
					<Route path="/sessions/:id/diff" element={<DiffRoute />} />
				</Routes>
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
