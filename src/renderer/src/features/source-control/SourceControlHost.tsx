import {
	Component,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { useDraftSessionsStore } from "../claude-sessions/stores/useDraftSessionsStore";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { useWorktreesStore } from "../claude-sessions/stores/useWorktreesStore";
import { T } from "../../design/tokens";
import { SourceControlPanel } from "./SourceControlPanel";
import {
	SCM_MAX_WIDTH,
	SCM_MIN_WIDTH,
	useSourceControlStore,
} from "./useSourceControlStore";
import { useSourceControlTriggers } from "./useSourceControlTriggers";

const CHAT_MIN_WIDTH = 360;

class SilentBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

export function SourceControlHost({ sessionId }: { sessionId?: string }) {
	return (
		<>
			<SilentBoundary>
				<SourceControlTriggers />
			</SilentBoundary>
			<SilentBoundary key={sessionId ?? ""}>
				<SourceControlMount sessionId={sessionId} />
			</SilentBoundary>
		</>
	);
}

function SourceControlTriggers() {
	useSourceControlTriggers();
	return null;
}

function SourceControlMount({ sessionId }: { sessionId?: string }) {
	const open = useSourceControlStore((s) => s.open);
	const sessionCwd = useSessionsStore((s) =>
		sessionId ? s.sessions[sessionId]?.cwd : undefined,
	);
	const sessionWorktreeId = useSessionsStore((s) =>
		sessionId ? s.sessions[sessionId]?.worktreeId : undefined,
	);
	const draftCwd = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft.cwd : undefined,
	);
	const draftWorktreeId = useDraftSessionsStore((s) =>
		s.draft && s.draft.id === sessionId ? s.draft.worktreeId : undefined,
	);
	const rootCwd = sessionCwd ?? draftCwd;
	const worktreeId = sessionWorktreeId ?? draftWorktreeId;
	const worktreePath = useWorktreesStore((s) =>
		worktreeId ? s.worktrees[worktreeId]?.worktreePath : undefined,
	);
	const hasEntry = useSourceControlStore((s) =>
		rootCwd ? s.byRoot[rootCwd] !== undefined : false,
	);

	useEffect(() => {
		if (!open || !rootCwd || hasEntry) return;
		void useSourceControlStore.getState().refresh(rootCwd);
	}, [open, rootCwd, hasEntry]);

	if (!open || !rootCwd) return null;

	return (
		<SourceControlShell>
			<SourceControlPanel
				rootCwd={rootCwd}
				activePath={worktreePath ?? rootCwd}
			/>
		</SourceControlShell>
	);
}

function measureMaxWidth(aside: HTMLElement): number {
	const parent = aside.parentElement;
	if (!parent) return SCM_MAX_WIDTH;
	let fixed = 0;
	for (const sibling of Array.from(parent.children)) {
		if (sibling === aside) continue;
		if (window.getComputedStyle(sibling).flexGrow !== "0") continue;
		fixed += sibling.getBoundingClientRect().width;
	}
	const available = Math.floor(parent.clientWidth - fixed - CHAT_MIN_WIDTH);
	return Math.max(SCM_MIN_WIDTH, Math.min(SCM_MAX_WIDTH, available));
}

function useMaxWidth(ref: { current: HTMLElement | null }): number {
	const [max, setMax] = useState(SCM_MAX_WIDTH);

	useLayoutEffect(() => {
		const aside = ref.current;
		const parent = aside?.parentElement;
		if (!aside || !parent || typeof ResizeObserver === "undefined") return;

		const measure = (): void => setMax(measureMaxWidth(aside));
		const sizes = new ResizeObserver(measure);
		const observeAll = (): void => {
			sizes.disconnect();
			sizes.observe(parent);
			for (const sibling of Array.from(parent.children)) {
				if (sibling !== aside) sizes.observe(sibling);
			}
			measure();
		};
		const children = new MutationObserver(observeAll);
		children.observe(parent, { childList: true });
		observeAll();

		return () => {
			sizes.disconnect();
			children.disconnect();
		};
	}, [ref]);

	return max;
}

function SourceControlShell({ children }: { children: ReactNode }) {
	const storedWidth = useSourceControlStore((s) => s.width);
	const setStoredWidth = useSourceControlStore((s) => s.setWidth);
	const [dragWidth, setDragWidth] = useState<number | null>(null);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const asideRef = useRef<HTMLElement | null>(null);
	const maxWidth = useMaxWidth(asideRef);
	const width = Math.min(dragWidth ?? storedWidth, maxWidth);

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		e.currentTarget.setPointerCapture(e.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ew-resize";
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		setDragWidth(
			Math.round(
				Math.min(
					maxWidth,
					Math.max(SCM_MIN_WIDTH, drag.startWidth - (e.clientX - drag.startX)),
				),
			),
		);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return;
		dragRef.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
		if (dragWidth !== null) setStoredWidth(dragWidth);
		setDragWidth(null);
	};

	return (
		<aside
			ref={asideRef}
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
				aria-label="Resize source control panel"
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
				<div style={{ width: 1, height: "100%", background: T.borderSoft }} />
			</div>
			{children}
		</aside>
	);
}
