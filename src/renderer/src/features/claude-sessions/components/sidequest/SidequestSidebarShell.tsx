import {
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { SidequestPanel } from "./SidequestPanel";
import { T } from "../../../../design/tokens";

const SIDEQUEST_DEFAULT_WIDTH = 420;
const SIDEQUEST_MIN_WIDTH = 280;

/**
 * Owns the resize handle + persisted width for the right sidequest panel.
 * Mirrors `NotesSidebarShell` exactly — handle on the LEFT edge, so dragging
 * left grows the panel.
 *
 * Width persists in `app_settings.json` as `sidequestSidebarWidth`. Single
 * IPC write per drag (on pointer-up).
 */
export function SidequestSidebarShell({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const persistedWidth = useSettingsStore((s) => s.sidequestSidebarWidth);
	const setPersistedWidth = useSettingsStore(
		(s) => s.setSidequestSidebarWidth,
	);
	const [width, setWidth] = useState<number>(
		persistedWidth ?? SIDEQUEST_DEFAULT_WIDTH,
	);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	// Adopt the persisted value once it hydrates from IPC. Skip while dragging
	// so we don't clobber the live value. `width` is intentionally NOT a dep.
	useEffect(() => {
		if (dragRef.current) return;
		if (persistedWidth !== undefined && persistedWidth !== width) {
			setWidth(persistedWidth);
		}
	}, [persistedWidth]);

	const computeMax = () => Math.min(720, Math.floor(window.innerWidth * 0.6));

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
		// Round to int — clientX is fractional on high-DPI displays and the
		// value goes through a Zod `int()` schema on pointer-up.
		const next = Math.round(
			Math.min(
				max,
				Math.max(SIDEQUEST_MIN_WIDTH, d.startWidth - (e.clientX - d.startX)),
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
				aria-label="Resize sidequest panel"
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
			<SidequestPanel sessionId={sessionId} onClose={onClose} />
		</aside>
	);
}
