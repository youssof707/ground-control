import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
import type { ScmFileStatus } from "@shared/schemas/source_control";
import { FileRow, rowId, type RowPointer } from "./FileRow";
import { nextIndex, scrollToReveal, visibleRange } from "./visibleRange";

export const ROW_HEIGHT = 26;
const OVERSCAN = 12;

export interface FileListRows {
	count: number;
	stagedCount: number;
	stagedTotal: number;
	unstagedTotal: number;
	path: (index: number) => string;
	status: (index: number) => ScmFileStatus;
	selected: (index: number) => boolean;
	viewed: (index: number) => boolean;
	commented: (index: number) => boolean;
}

export interface FileListHandle {
	focus: () => void;
}

export interface Layout {
	stagedHeader: boolean;
	changesHeader: boolean;
	spacer: boolean;
	total: number;
}

export function layoutOf(count: number, stagedCount: number): Layout {
	const stagedHeader = stagedCount > 0;
	const changesHeader = count > stagedCount;
	const spacer = stagedHeader && changesHeader;
	return {
		stagedHeader,
		changesHeader,
		spacer,
		total: count + (stagedHeader ? 1 : 0) + (changesHeader ? 1 : 0) + (spacer ? 1 : 0),
	};
}

export function slotOfRow(layout: Layout, stagedCount: number, row: number): number {
	const before = row >= stagedCount && layout.changesHeader ? (layout.spacer ? 2 : 1) : 0;
	return row + (layout.stagedHeader ? 1 : 0) + before;
}

export type Slot = { kind: "header"; staged: boolean } | { kind: "spacer" } | { kind: "row"; row: number };

export function rowOfSlot(layout: Layout, stagedCount: number, slot: number): Slot {
	let rest = slot;
	if (layout.stagedHeader) {
		if (rest === 0) return { kind: "header", staged: true };
		if (rest <= stagedCount) return { kind: "row", row: rest - 1 };
		rest -= stagedCount + 1;
	}
	if (layout.spacer) {
		if (rest === 0) return { kind: "spacer" };
		rest -= 1;
	}
	if (rest === 0 && layout.changesHeader) return { kind: "header", staged: false };
	return { kind: "row", row: stagedCount + rest - (layout.changesHeader ? 1 : 0) };
}

function GroupHeader({
	staged,
	total,
	top,
	onContext,
	commitLabel,
	onCommit,
	committing,
	onStageAll,
	staging,
}: {
	staged: boolean;
	total: number;
	top: number;
	onContext: (staged: boolean, x: number, y: number) => void;
	commitLabel?: string;
	onCommit?: () => void;
	committing: boolean;
	onStageAll?: () => void;
	staging: boolean;
}) {
	return (
		<div
			className="scm-group"
			style={{ top, height: ROW_HEIGHT }}
			role="presentation"
			onMouseDown={(e) => e.preventDefault()}
			onContextMenu={(e) => {
				e.preventDefault();
				onContext(staged, e.clientX, e.clientY);
			}}
		>
			<span className="scm-group-title">{staged ? "Staged Changes" : "Changes"}</span>
			<span className="scm-group-count">{total.toLocaleString("en-US")}</span>
			{onStageAll ? (
				<button
					type="button"
					className="scm-group-commit"
					tabIndex={-1}
					disabled={staging}
					onClick={onStageAll}
				>
					Stage All
				</button>
			) : null}
			{onCommit ? (
				<button
					type="button"
					className="scm-group-commit"
					tabIndex={-1}
					disabled={committing}
					onClick={onCommit}
				>
					{committing ? <span className="asyncy-btn-spinner" aria-hidden="true" /> : null}
					{committing ? "Committing" : commitLabel}
				</button>
			) : null}
		</div>
	);
}

export const FileList = forwardRef<
	FileListHandle,
	{
		rows: FileListRows;
		focused: number;
		label: string;
		onPointer: (index: number, pointer: RowPointer) => void;
		onMove: (index: number, extend: boolean) => void;
		onSelectAll: () => void;
		onRowContext: (index: number, x: number, y: number) => void;
		onGroupContext: (staged: boolean, x: number, y: number) => void;
		onViewed: (index: number) => void;
		onCommit: (all: boolean) => void;
		committing: boolean;
		onStageAll: () => void;
		staging: boolean;
	}
>(function FileList(
	{
		rows,
		focused,
		label,
		onPointer,
		onMove,
		onSelectAll,
		onRowContext,
		onGroupContext,
		onViewed,
		onCommit,
		committing,
		onStageAll,
		staging,
	},
	ref,
) {
	const listRef = useRef<HTMLDivElement>(null);
	const frame = useRef<number | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewport, setViewport] = useState(0);
	const layout = layoutOf(rows.count, rows.stagedCount);

	useImperativeHandle(ref, () => ({
		focus: () => listRef.current?.focus({ preventScroll: true }),
	}));

	useLayoutEffect(() => {
		const el = listRef.current;
		if (!el) return;
		setViewport(el.clientHeight);
		const observer = new ResizeObserver(() => setViewport(el.clientHeight));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		},
		[],
	);

	const onScroll = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			const el = listRef.current;
			if (el) setScrollTop(el.scrollTop);
		});
	}, []);

	const focusedSlot = focused >= 0 && focused < rows.count ? slotOfRow(layout, rows.stagedCount, focused) : -1;
	const headerAbove =
		focusedSlot > 0 && (focused === 0 || focused === rows.stagedCount)
			? ROW_HEIGHT * (focused === rows.stagedCount && layout.spacer ? 2 : 1)
			: 0;

	useLayoutEffect(() => {
		const el = listRef.current;
		if (!el || focusedSlot < 0 || viewport === 0) return;
		let next = scrollToReveal(focusedSlot, el.scrollTop, el.clientHeight, ROW_HEIGHT);
		if (headerAbove && next > focusedSlot * ROW_HEIGHT - headerAbove && next <= focusedSlot * ROW_HEIGHT) {
			next = Math.max(0, focusedSlot * ROW_HEIGHT - headerAbove);
		}
		if (next !== el.scrollTop) {
			el.scrollTop = next;
			setScrollTop(next);
		}
	}, [focusedSlot, headerAbove, viewport]);

	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
		if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
			e.preventDefault();
			onSelectAll();
			return;
		}
		if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
			e.preventDefault();
			if (focused < 0 || focused >= rows.count) return;
			const rect = listRef.current
				?.querySelector<HTMLElement>(`#${rowId(focused)}`)
				?.getBoundingClientRect();
			if (rect) onRowContext(focused, rect.left + 24, rect.bottom);
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const pageSize = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
		const next = nextIndex(e.key, focused, rows.count, pageSize);
		if (next === null) return;
		e.preventDefault();
		onMove(next, e.shiftKey);
	};

	const { start, end } = visibleRange(scrollTop, viewport, ROW_HEIGHT, layout.total, OVERSCAN);
	const items: ReactNode[] = [];
	for (let slot = start; slot < end; slot++) {
		const at = rowOfSlot(layout, rows.stagedCount, slot);
		if (at.kind === "spacer") continue;
		if (at.kind === "header") {
			items.push(
				<GroupHeader
					key={at.staged ? "h-staged" : "h-changes"}
					staged={at.staged}
					total={at.staged ? rows.stagedTotal : rows.unstagedTotal}
					top={slot * ROW_HEIGHT}
					onContext={onGroupContext}
					commitLabel={at.staged ? "Commit" : "Commit All"}
					onCommit={
						at.staged ? () => onCommit(false) : rows.stagedTotal === 0 ? () => onCommit(true) : undefined
					}
					committing={committing}
					onStageAll={at.staged ? undefined : onStageAll}
					staging={staging}
				/>,
			);
			continue;
		}
		const i = at.row;
		items.push(
			<FileRow
				key={i}
				index={i}
				path={rows.path(i)}
				status={rows.status(i)}
				staged={i < rows.stagedCount}
				top={slot * ROW_HEIGHT}
				height={ROW_HEIGHT}
				selected={rows.selected(i)}
				focused={i === focused}
				viewed={rows.viewed(i)}
				commented={rows.commented(i)}
				onPointer={onPointer}
				onContext={onRowContext}
				onViewed={onViewed}
			/>,
		);
	}

	return (
		<div
			ref={listRef}
			className="scm-list"
			role="listbox"
			aria-multiselectable="true"
			aria-label={label}
			aria-activedescendant={focused >= 0 && focused < rows.count ? rowId(focused) : undefined}
			tabIndex={0}
			onScroll={onScroll}
			onKeyDown={onKeyDown}
		>
			<div style={{ height: layout.total * ROW_HEIGHT, position: "relative" }}>{items}</div>
		</div>
	);
});
