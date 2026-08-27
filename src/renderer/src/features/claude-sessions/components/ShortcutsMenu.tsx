import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Shortcut } from "@shared/schemas/shortcuts";
import { T } from "../../../design/tokens";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import { shortcutLabel } from "./ShortcutForm";
import { CreateShortcutModal } from "./CreateShortcutModal";
import { EditShortcutsModal } from "./EditShortcutsModal";

/**
 * The single shortcuts ⚡ menu, used both by the sidebar (where running a
 * shortcut starts a new session) and by the composer footer (where running
 * a shortcut appends into the session you're already in). Same model, same
 * list, same create/edit modals — only the panel's anchor direction and the
 * trigger button's styling differ per call site, via props.
 */
export function ShortcutsMenuButton({
	placement,
	buttonClassName,
	buttonStyle,
	disabled,
	onRun,
}: {
	/** Which way the panel opens: "down" from a header-row button, "up" from
	 * a composer pinned to the bottom of the window. Both variants anchor
	 * their right edge to the button's right edge. */
	placement: "down" | "up";
	buttonClassName: string;
	buttonStyle?: CSSProperties;
	disabled?: boolean;
	onRun: (sc: Shortcut) => void;
}) {
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);
	const shortcutsById = useShortcutsStore((s) => s.shortcuts);
	const shortcuts = useMemo(
		() =>
			Object.values(shortcutsById).sort((a, b) =>
				shortcutLabel(a).localeCompare(shortcutLabel(b), undefined, {
					sensitivity: "base",
				}),
			),
		[shortcutsById],
	);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				className={buttonClassName}
				onClick={() => setOpen((o) => !o)}
				disabled={disabled}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Shortcuts"
				style={{ color: open ? T.text : T.textDim, ...buttonStyle }}
			>
				{/* Lightning bolt — the conventional shortcut glyph. */}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path
						d="M7.8 1.5L3.5 7.8h3.1l-.4 4.7 4.3-6.3H7.4l.4-4.7z"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			</button>
			{open ? (
				<div
					role="menu"
					style={{
						position: "absolute",
						...(placement === "down"
							? { top: "calc(100% + 4px)" }
							: { bottom: "calc(100% + 4px)" }),
						right: 0,
						minWidth: 220,
						maxHeight: 280,
						overflowY: "auto",
						background: T.surfaceHi,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
						padding: 4,
						zIndex: 50,
						boxShadow:
							placement === "down"
								? "0 8px 24px rgba(0,0,0,0.18)"
								: "0 -8px 24px rgba(0,0,0,0.18)",
					}}
				>
					{shortcuts.map((sc) => (
						<ShortcutMenuItem
							key={sc.id}
							label={shortcutLabel(sc)}
							onClick={() => {
								setOpen(false);
								onRun(sc);
							}}
						/>
					))}
					{shortcuts.length > 0 ? (
						<div
							role="separator"
							style={{
								height: 0,
								borderTop: `0.5px solid ${T.borderSoft}`,
								margin: "4px 2px",
							}}
						/>
					) : null}
					<ShortcutMenuItem
						label="Create shortcut"
						onClick={() => {
							setOpen(false);
							setCreating(true);
						}}
					/>
					{shortcuts.length > 0 ? (
						<ShortcutMenuItem
							label="Edit shortcuts"
							onClick={() => {
								setOpen(false);
								setEditing(true);
							}}
						/>
					) : null}
				</div>
			) : null}
			<CreateShortcutModal open={creating} onClose={() => setCreating(false)} />
			<EditShortcutsModal open={editing} onClose={() => setEditing(false)} />
		</div>
	);
}

/**
 * Menu row for the shortcuts dropdown. A trimmed private implementation
 * rather than a reuse of SessionsList's `MenuItem` — that one carries
 * active/danger/checkbox/mono affordances this menu never needs, and
 * hoisting it would churn its dozen other call sites in a 2900-line file.
 */
function ShortcutMenuItem({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			style={{
				display: "flex",
				alignItems: "center",
				width: "100%",
				textAlign: "left",
				padding: "6px 10px",
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.text,
				fontSize: 13,
				cursor: "pointer",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = T.surface;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
			}}
		>
			<span
				style={{
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
				}}
			>
				{label}
			</span>
		</button>
	);
}
