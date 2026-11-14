import { useEffect, useState } from "react";
import { useMatch } from "react-router-dom";
import type { TerminalInfo } from "@shared/schemas/terminals";
import { T } from "../../../design/tokens";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
	TERMINAL_DOT,
	type TerminalGroup,
	groupLabel,
	groupLastLine,
	groupStatus,
	groupTerminals,
	useTerminalsStore,
} from "../stores/useTerminalsStore";
import { useWorktreesStore } from "../stores/useWorktreesStore";
import { useInlineConfirm } from "../hooks/useInlineConfirm";
import { StatusDot } from "./SchedulerWidget";
import {
	CloseIcon,
	PlayIcon,
	StopIcon,
	TerminalModal,
} from "./TerminalModal";

const MAX_VISIBLE_ROWS = 5;
const ROW_HEIGHT = 28;
const ROW_GAP = 2;

const ELLIPSIS = {
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
} as const;

const BARE_BUTTON = {
	appearance: "none",
	border: "none",
	background: "transparent",
	cursor: "pointer",
	font: "inherit",
} as const;

const ROW_ICON_BUTTON = {
	...BARE_BUTTON,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: 22,
	height: 22,
	borderRadius: 4,
	color: T.textMute,
	flexShrink: 0,
} as const;

function resolveTerminalCwd(
	activeSessionId: string | undefined,
): string | undefined {
	const session = activeSessionId
		? useSessionsStore.getState().sessions[activeSessionId]
		: undefined;
	if (!session) return useSettingsStore.getState().lastUsedWorkspace;
	const worktree = session.worktreeId
		? useWorktreesStore.getState().worktrees[session.worktreeId]
		: undefined;
	return worktree?.worktreePath ?? session.cwd;
}

export function TerminalsCard() {
	const activeSessionId = useMatch("/sessions/:id/*")?.params.id;
	const terminals = useTerminalsStore((s) => s.terminals);
	const openGroupId = useTerminalsStore((s) => s.openGroupId);
	const groups = groupTerminals(terminals);

	useEffect(() => {
		const { refresh, setTerminals } = useTerminalsStore.getState();
		const off = window.claude.on("terminals:changed", (payload) =>
			setTerminals(payload as TerminalInfo[]),
		);
		void refresh();
		return off;
	}, []);

	const openGroup = groups.find((g) => g.id === openGroupId);

	return (
		<>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: ROW_GAP,
					padding: 4,
					marginBottom: 4,
					background: T.surface,
					border: `0.5px solid ${T.border}`,
					borderRadius: 8,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						height: ROW_HEIGHT,
						padding: "0 4px 0 8px",
						fontSize: 13,
						fontWeight: 500,
					}}
				>
					<span
						style={{
							display: "inline-flex",
							justifyContent: "center",
							width: 14,
							color: T.textDim,
							flexShrink: 0,
						}}
					>
						<TerminalIcon />
					</span>
					<span style={{ color: T.text, flexShrink: 0 }}>Terminals</span>
					{groups.length > 0 ? (
						<span
							style={{
								marginLeft: -2,
								color: T.textMute,
								fontSize: 11,
								fontFamily: T.mono,
							}}
						>
							{groups.length}
						</span>
					) : null}
					<button
						type="button"
						className="sched-card-row"
						onClick={() =>
							void useTerminalsStore
								.getState()
								.add(resolveTerminalCwd(activeSessionId))
						}
						style={{
							...BARE_BUTTON,
							marginLeft: "auto",
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							height: 22,
							padding: "0 7px",
							borderRadius: 5,
							color: T.textDim,
							fontSize: 11.5,
							fontWeight: 500,
							flexShrink: 0,
						}}
					>
						<svg
							width="11"
							height="11"
							viewBox="0 0 14 14"
							fill="none"
							aria-hidden
						>
							<path
								d="M7 3v8M3 7h8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
						Add Terminal
					</button>
				</div>
				{groups.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: ROW_GAP,
							maxHeight:
                MAX_VISIBLE_ROWS * ROW_HEIGHT +
                (MAX_VISIBLE_ROWS - 1) * ROW_GAP,
							overflowY: "auto",
						}}
					>
						{groups.map((group) => (
							<TerminalRow
								key={group.id}
								group={group}
								active={group.id === openGroupId}
							/>
						))}
					</div>
				) : null}
			</div>
			{openGroup ? <TerminalModal group={openGroup} /> : null}
		</>
	);
}

function TerminalRow({
	group,
	active,
}: {
	group: TerminalGroup;
	active: boolean;
}) {
	const [hovered, setHovered] = useState(false);
	const label = groupLabel(group);
	const count = group.terminals.length;
	const canStop = group.terminals.some((t) => t.status === "running");
	const canStart = group.terminals.some(
		(t) => t.status === "idle" && Boolean(t.lastCommand),
	);
	const kill = useInlineConfirm(
		() => void useTerminalsStore.getState().killGroup(group.id),
		group.terminals.some((t) => t.status !== "crashed"),
	);
	return (
		<div
			className="sched-card-row"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
				kill.reset();
			}}
			style={{
				display: "flex",
				alignItems: "center",
				height: ROW_HEIGHT,
				flexShrink: 0,
				borderRadius: 5,
				background: active ? T.surfaceHi : "transparent",
			}}
		>
			<button
				type="button"
				onClick={() => useTerminalsStore.getState().open(group.id)}
				style={{
					...BARE_BUTTON,
					display: "flex",
					alignItems: "center",
					gap: 8,
					flex: 1,
					minWidth: 0,
					height: "100%",
					padding: "0 4px 0 8px",
					textAlign: "left",
					fontSize: 12,
					color: T.textMute,
				}}
			>
				<span
					style={{
						display: "inline-flex",
						justifyContent: "center",
						width: 14,
						flexShrink: 0,
					}}
				>
					<StatusDot color={TERMINAL_DOT[groupStatus(group)]} />
				</span>
				<span
					style={{
						...ELLIPSIS,
						color: active ? T.text : T.textDim,
						flexShrink: 0,
						maxWidth: "40%",
					}}
				>
					{label}
				</span>
				{count > 1 ? (
					<span
						style={{
							marginLeft: -4,
							color: T.textMute,
							fontSize: 11,
							fontFamily: T.mono,
							flexShrink: 0,
						}}
					>
						{count}
					</span>
				) : null}
				<span style={{ ...ELLIPSIS, flex: 1 }}>{groupLastLine(group)}</span>
			</button>
			{!kill.confirming && canStart ? (
				<button
					type="button"
					className="terminal-row-control"
					aria-label={`Start terminal ${label}`}
					onClick={() => void useTerminalsStore.getState().rerunGroup(group.id)}
					style={{ ...ROW_ICON_BUTTON, opacity: hovered ? 1 : 0 }}
				>
					<PlayIcon />
				</button>
			) : null}
			{!kill.confirming && canStop ? (
				<button
					type="button"
					className="terminal-row-control"
					aria-label={`Stop terminal ${label}`}
					onClick={() => void useTerminalsStore.getState().stopGroup(group.id)}
					style={{ ...ROW_ICON_BUTTON, opacity: hovered ? 1 : 0 }}
				>
					<StopIcon />
				</button>
			) : null}
			{kill.confirming ? (
				<button
					type="button"
					aria-label={`Confirm delete terminal ${label}`}
					onClick={kill.click}
					style={{
						...BARE_BUTTON,
						display: "inline-flex",
						alignItems: "center",
						height: 20,
						padding: "0 8px",
						marginRight: 4,
						borderRadius: 5,
						border: `0.5px solid ${T.dangerBorder}`,
						background: T.dangerSoft,
						color: T.danger,
						fontSize: 11,
						fontWeight: 500,
						flexShrink: 0,
					}}
				>
					Delete?
				</button>
			) : (
				<button
					type="button"
					className="terminal-row-control"
					aria-label={`Delete terminal ${label}`}
					onClick={kill.click}
					style={{
						...ROW_ICON_BUTTON,
						marginRight: 3,
						opacity: hovered ? 1 : 0,
					}}
				>
					<CloseIcon />
				</button>
			)}
		</div>
	);
}

function TerminalIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
			<rect
				x="1.6"
				y="2.6"
				width="10.8"
				height="8.8"
				rx="1.8"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
			<path
				d="M4.2 5.6l1.8 1.5-1.8 1.5M7.4 8.7h2.4"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
