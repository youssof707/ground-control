import { Link, useMatch } from "react-router-dom";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useReadStore } from "../stores/useReadStore";
import { T } from "../../../design/tokens";
import type { ClaudeSessionFull } from "@shared/claude-sessions/types";
import type { RightPanel } from "../../../MainApp";

function lastIncomingMessageTs(session: ClaudeSessionFull): number {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const m = session.messages[i];
		if (m.role === "assistant") return m.ts;
	}
	return 0;
}

export function AppNav({
	rightPanel,
	setRightPanel,
}: {
	rightPanel: RightPanel;
	setRightPanel: (v: RightPanel) => void;
}) {
	const queue = usePermissionsStore((s) => s.queue);
	const sessionsMap = useSessionsStore((s) => s.sessions);
	const sessionsOrder = useSessionsStore((s) => s.order);
	const lastReadAt = useReadStore((s) => s.lastReadAt);
	const inSession = !!useMatch("/sessions/:id/*");

	const runningCount = sessionsOrder.filter(
		(id) => sessionsMap[id]?.status === "running",
	).length;

	const waitingCount = new Set(queue.map((q) => q.sessionId)).size;

	const unreadCount = sessionsOrder.reduce((acc, id) => {
		const sess = sessionsMap[id];
		if (!sess) return acc;
		if (sess.status === "running") return acc;
		const lastIncoming = lastIncomingMessageTs(sess);
		if (lastIncoming > 0 && lastIncoming > (lastReadAt[id] ?? 0)) {
			return acc + 1;
		}
		return acc;
	}, 0);

	return (
		<nav
			style={{
				height: 52,
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				gap: 4,
				padding: "0 18px",
				borderBottom: `0.5px solid ${T.border}`,
				background: T.win,
			}}
		>
			<Link
				to="/"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginRight: 18,
					textDecoration: "none",
				}}
			>
				<Logo />
				<span
					style={{
						fontSize: 13.5,
						fontWeight: 600,
						color: T.text,
						letterSpacing: "-0.1px",
					}}
				>
					Ground Control
				</span>
			</Link>
			<div
				style={{
					width: 1,
					height: 18,
					background: T.border,
					marginRight: 14,
				}}
			/>
			<div
				style={{
					display: "flex",
					gap: 14,
					alignItems: "center",
					fontSize: 13,
					color: T.textDim,
				}}
			>
				<Stat
					n={runningCount}
					label="running"
					dot={runningCount > 0 ? T.ok : undefined}
				/>
				<Sep />
				<Stat
					n={unreadCount}
					label="unread"
					dot={unreadCount > 0 ? T.accent : undefined}
				/>
				<Sep />
				<Stat
					n={waitingCount}
					label="waiting"
					dot={waitingCount > 0 ? T.warn : undefined}
				/>
			</div>
			<div style={{ flex: 1 }} />
			{inSession ? (
				<NotesToggle
					active={rightPanel === "notes"}
					onClick={() =>
						setRightPanel(rightPanel === "notes" ? null : "notes")
					}
				/>
			) : null}
			<InboxToggle
				active={rightPanel === "inbox"}
				badge={queue.length}
				onClick={() =>
					setRightPanel(rightPanel === "inbox" ? null : "inbox")
				}
			/>
		</nav>
	);
}

function NotesToggle({
	active,
	onClick,
}: {
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 12px",
				borderRadius: 8,
				fontSize: 13,
				fontWeight: 500,
				color: active ? T.text : T.textMute,
				background: active ? T.surface : "transparent",
				boxShadow: active ? `inset 0 0 0 0.5px ${T.border}` : "none",
				border: "none",
				cursor: "pointer",
				marginRight: 6,
			}}
		>
			<span>Notes</span>
		</button>
	);
}

function InboxToggle({
	active,
	badge,
	onClick,
}: {
	active: boolean;
	badge: number;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 12px",
				borderRadius: 8,
				fontSize: 13,
				fontWeight: 500,
				color: active ? T.text : T.textMute,
				background: active ? T.surface : "transparent",
				boxShadow: active ? `inset 0 0 0 0.5px ${T.border}` : "none",
				border: "none",
				cursor: "pointer",
			}}
		>
			<span>Inbox</span>
			{badge > 0 ? (
				<span
					style={{
						minWidth: 18,
						height: 18,
						padding: "0 6px",
						borderRadius: 9,
						background: active ? T.accent : T.accentSoft,
						color: active ? T.accentInk : T.accent,
						fontSize: 11,
						fontWeight: 600,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						fontFamily: T.mono,
						letterSpacing: "-0.2px",
					}}
				>
					{badge}
				</span>
			) : null}
		</button>
	);
}

function Stat({ n, label, dot }: { n: number; label: string; dot?: string }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			{dot ? (
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: dot,
					}}
				/>
			) : null}
			<span
				style={{
					fontFamily: T.mono,
					color: T.text,
					fontWeight: 500,
				}}
			>
				{n}
			</span>
			<span style={{ color: T.textMute }}>{label}</span>
		</div>
	);
}

function Sep() {
	return (
		<span
			style={{
				width: 3,
				height: 3,
				borderRadius: "50%",
				background: T.border,
			}}
		/>
	);
}

function Logo() {
	return (
		<div
			style={{
				width: 22,
				height: 22,
				borderRadius: 6,
				background: T.accentSoft,
				border: `0.5px solid ${T.accentBorder}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: T.accent,
				fontFamily: T.mono,
				fontSize: 11,
				fontWeight: 700,
				letterSpacing: "-0.5px",
			}}
		>
			{"</>"}
		</div>
	);
}
