import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
	MAX_TERMINAL_GROUP_SIZE,
	type TerminalDataEvent,
	type TerminalInfo,
} from "@shared/schemas/terminals";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import {
	TERMINAL_DOT,
	type TerminalGroup,
	folderName,
	groupLabel,
	groupStatus,
	useTerminalsStore,
} from "../stores/useTerminalsStore";
import { useInlineConfirm } from "../hooks/useInlineConfirm";
import { StatusDot } from "./SchedulerWidget";
import { LoadConfigButton, SaveConfigButton } from "./TerminalConfigButtons";

const TERMINAL_BACKGROUND = "#1c1916";

const THEME = {
	background: TERMINAL_BACKGROUND,
	foreground: "#edebe7",
	cursor: "#edebe7",
	cursorAccent: TERMINAL_BACKGROUND,
	selectionBackground: "#7fb6ee55",
	black: "#312d2a",
	red: "#fa6863",
	green: "#6cd092",
	yellow: "#f2943c",
	blue: "#7fb6ee",
	magenta: "#d4a0ec",
	cyan: "#72cede",
	white: "#a8a49f",
	brightBlack: "#78746e",
	brightRed: "#fa6863",
	brightGreen: "#6cd092",
	brightYellow: "#f2943c",
	brightBlue: "#7fb6ee",
	brightMagenta: "#d4a0ec",
	brightCyan: "#72cede",
	brightWhite: "#edebe7",
} as const;

const GRID_AREAS: Record<number, string> = {
	1: '"p0"',
	2: '"p0 p1"',
	3: '"p0 p1" "p2 p1"',
	4: '"p0 p1" "p2 p3"',
};

export function TerminalModal({ group }: { group: TerminalGroup }) {
	const close = useTerminalsStore((s) => s.close);
	const focusId = useTerminalsStore((s) => s.focusId);
	const backdropProps = useBackdropDismiss(close);
	const { terminals } = group;
	const count = terminals.length;
	const focusedId =
		terminals.find((t) => t.id === focusId)?.id ?? terminals[0]?.id;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (e.target instanceof HTMLInputElement) return;
			e.preventDefault();
			e.stopPropagation();
			close();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [close]);

	const kill = useInlineConfirm(
		() => void useTerminalsStore.getState().killGroup(group.id),
		terminals.some((t) => t.status !== "crashed"),
	);
	const canSplit = count < MAX_TERMINAL_GROUP_SIZE && focusedId !== undefined;

	return createPortal(
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-label="Terminal"
				style={{
					width: "min(1200px, calc(100vw - 32px))",
					height: "min(760px, calc(91vh - 24px))",
					padding: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					boxSizing: "border-box",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "10px 10px 10px 16px",
						borderBottom: `0.5px solid ${T.borderSoft}`,
						flexShrink: 0,
					}}
				>
					<StatusDot color={TERMINAL_DOT[groupStatus(group)]} />
					<TerminalName group={group} />
					<span
						style={{
							flex: 1,
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							direction: "rtl",
							textAlign: "left",
							fontSize: 12,
							fontFamily: T.mono,
							color: T.textMute,
						}}
					>
						<bdi>{terminals[0]?.cwd}</bdi>
					</span>
					<SaveConfigButton group={group} />
					<LoadConfigButton group={group} />
					<button
						type="button"
						className="btn btn-ghost"
						disabled={!canSplit}
						onClick={() => {
							if (focusedId) void useTerminalsStore.getState().split(focusedId);
						}}
						style={{
							height: 26,
							padding: "0 10px",
							fontSize: 12,
							gap: 6,
							display: "inline-flex",
							alignItems: "center",
						}}
					>
						<SplitIcon />
						Split
					</button>
					<button
						type="button"
						className="btn btn-destructive"
						onClick={kill.click}
						onBlur={kill.reset}
						style={{ height: 26, padding: "0 10px", fontSize: 12 }}
					>
						{kill.confirming ? "Confirm delete" : "Delete"}
					</button>
					<button
						type="button"
						className="btn btn-ghost btn-icon"
						aria-label="Close terminal window"
						onClick={close}
						style={{ width: 26, height: 26 }}
					>
						<CloseIcon />
					</button>
				</div>
				<div
					style={{
						flex: 1,
						minHeight: 0,
						display: "grid",
						gridTemplateAreas: GRID_AREAS[count] ?? GRID_AREAS[1],
						gridTemplateColumns: count > 1 ? "1fr 1fr" : "1fr",
						gridTemplateRows: count > 2 ? "1fr 1fr" : "1fr",
						gap: 1,
						background: T.borderSoft,
					}}
				>
					{terminals.map((terminal, index) => (
						<TerminalPane
							key={terminal.id}
							terminal={terminal}
							area={`p${index}`}
							focused={terminal.id === focusedId}
							split={count > 1}
						/>
					))}
				</div>
			</div>
		</div>,
		document.body,
	);
}

function TerminalPane({
	terminal,
	area,
	focused,
	split,
}: {
	terminal: TerminalInfo;
	area: string;
	focused: boolean;
	split: boolean;
}) {
	const { id } = terminal;
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			fontFamily: T.mono,
			fontSize: 12.5,
			cursorBlink: true,
			scrollback: 5000,
			macOptionIsMeta: true,
			theme: THEME,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);
		termRef.current = term;

		const fitToContainer = () => {
			try {
				fit.fit();
			} catch {
				return;
			}
		};

		let snapshotSeq: number | null = null;
		const queued: TerminalDataEvent[] = [];
		const offData = window.claude.on("terminals:data", (payload) => {
			const event = payload as TerminalDataEvent;
			if (event.id !== id) return;
			if (snapshotSeq === null) queued.push(event);
			else term.write(event.data);
		});

		let disposed = false;
		void window.claude.terminalSnapshot(id).then((snapshot) => {
			if (disposed || !snapshot) return;
			term.write(snapshot.data);
			snapshotSeq = snapshot.seq;
			for (const event of queued) {
				if (event.seq > snapshot.seq) term.write(event.data);
			}
			queued.length = 0;
		});

		const inputSub = term.onData((data) =>
			window.claude.writeTerminal(id, data),
		);
		const resizeSub = term.onResize(({ cols, rows }) =>
			window.claude.resizeTerminal(id, cols, rows),
		);
		fitToContainer();
		window.claude.resizeTerminal(id, term.cols, term.rows);

		const observer = new ResizeObserver(fitToContainer);
		observer.observe(container);

		return () => {
			disposed = true;
			termRef.current = null;
			observer.disconnect();
			offData();
			inputSub.dispose();
			resizeSub.dispose();
			term.dispose();
		};
	}, [id]);

	useEffect(() => {
		if (focused) termRef.current?.focus();
	}, [focused]);

	const kill = useInlineConfirm(
		() => void useTerminalsStore.getState().kill(id),
		terminal.status !== "crashed",
	);
	const showKill = split && (hovered || kill.confirming);

	return (
		<div
			onFocusCapture={() => useTerminalsStore.getState().setFocus(id)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
				kill.reset();
			}}
			style={{
				gridArea: area,
				position: "relative",
				minWidth: 0,
				minHeight: 0,
				padding: "8px 4px 8px 10px",
				background: TERMINAL_BACKGROUND,
				boxShadow:
					split && focused ? `inset 0 0 0 1px ${T.accentBorder}` : "none",
			}}
		>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
			{showKill ? (
				<button
					type="button"
					className={kill.confirming ? "btn btn-destructive" : "btn btn-ghost"}
					aria-label={
						kill.confirming ? "Confirm delete pane" : "Delete pane"
					}
					onClick={kill.click}
					style={{
						position: "absolute",
						top: 6,
						right: 6,
						zIndex: 5,
						height: 22,
						minWidth: 22,
						padding: kill.confirming ? "0 8px" : 0,
						fontSize: 11,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{kill.confirming ? "Delete?" : <CloseIcon />}
				</button>
			) : null}
		</div>
	);
}

function TerminalName({ group }: { group: TerminalGroup }) {
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		setDraft(null);
		const next = draft.trim();
		if (next === groupLabel(group)) return;
		void useTerminalsStore.getState().renameGroup(group.id, next);
	};

	const nameStyle = {
		flexShrink: 0,
		maxWidth: "40%",
		height: 24,
		padding: "0 6px",
		marginLeft: -6,
		borderRadius: 5,
		fontSize: 13,
		fontWeight: 500,
		color: T.text,
		fontFamily: "inherit",
	} as const;

	if (draft !== null) {
		return (
			<input
				autoFocus
				value={draft}
				placeholder={folderName(group.terminals[0]?.cwd ?? "")}
				aria-label="Terminal name"
				onFocus={(e) => e.currentTarget.select()}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") setDraft(null);
				}}
				style={{
					...nameStyle,
					width: 200,
					border: `0.5px solid ${T.border}`,
					background: T.surface,
					outline: "none",
				}}
			/>
		);
	}

	return (
		<button
			type="button"
			className="sched-card-row"
			aria-label={`Rename terminal ${groupLabel(group)}`}
			onClick={() => setDraft(groupLabel(group))}
			style={{
				...nameStyle,
				appearance: "none",
				border: "none",
				background: "transparent",
				cursor: "text",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			}}
		>
			{groupLabel(group)}
		</button>
	);
}

export function CloseIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
			<path
				d="M2 2l6 6M8 2l-6 6"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function SplitIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
			<rect
				x="1.6"
				y="2.1"
				width="10.8"
				height="9.8"
				rx="1.8"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
			<path d="M7 2.4v9.2" stroke="currentColor" strokeWidth="1.2" />
		</svg>
	);
}
