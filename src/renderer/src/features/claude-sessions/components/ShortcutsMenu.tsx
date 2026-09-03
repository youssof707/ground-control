import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import { useSkillsStore } from "../stores/useSkillsStore";
import { promptPreview, shortcutLabel } from "./ShortcutForm";
import { CreateShortcutModal } from "./CreateShortcutModal";
import { EditShortcutsModal } from "./EditShortcutsModal";

type Tab = "skills" | "shortcuts";

type Row = {
	key: string;
	label: string;
	description: string;
	run: () => void;
};

/**
 * The single shortcuts ⚡ launcher, used by the sidebar (where running an
 * entry starts a new session), the composer footer (where running an entry
 * inserts into the session you're already in), and the global Cmd+K palette
 * (`CommandPaletteModal`, which picks one of those same two behaviors based
 * on focus). All three drive the same `ShortcutsPickerModal` below — this
 * component is just a button that owns its own local open state as the
 * click-triggered entry point.
 */
export function ShortcutsMenuButton({
	buttonClassName,
	buttonStyle,
	disabled,
	onRun,
	onRunSkill,
}: {
	buttonClassName: string;
	buttonStyle?: CSSProperties;
	disabled?: boolean;
	onRun: (sc: Shortcut) => void;
	onRunSkill: (skill: Skill) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				className={buttonClassName}
				onClick={() => setOpen(true)}
				disabled={disabled}
				aria-haspopup="dialog"
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
			<ShortcutsPickerModal
				open={open}
				onOpenChange={setOpen}
				onRun={onRun}
				onRunSkill={onRunSkill}
			/>
		</>
	);
}

/**
 * The two-tab Skills/Shortcuts picker itself, extracted out of
 * `ShortcutsMenuButton` so the global Cmd+K palette can drive one shared
 * instance (`CommandPaletteModal`) without duplicating this UI:
 *
 * - "Skills" (default): the user's personal global Claude skills from
 *   `~/.claude/skills/` — clicking one inserts its `/name` slash command.
 *   Every open kicks off an async re-read of the directory; the in-memory
 *   list renders immediately with a spinner beside the tabs while the
 *   refresh is in flight (never block on disk).
 * - "Shortcuts": the saved reusable prompts, with the create/edit entry
 *   points living inside the modal. Create/Edit close this modal before
 *   opening theirs (no stacked backdrops or dueling Escape handlers).
 */
export function ShortcutsPickerModal({
	open,
	onOpenChange,
	onRun,
	onRunSkill,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRun: (sc: Shortcut) => void;
	onRunSkill: (skill: Skill) => void;
}) {
	const closeMenu = useCallback(() => onOpenChange(false), [onOpenChange]);
	const backdropProps = useBackdropDismiss(closeMenu);
	const [tab, setTab] = useState<Tab>("skills");
	const [refreshing, setRefreshing] = useState(false);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);

	const skills = useSkillsStore((s) => s.skills);
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

	// Uniform shape for the active tab's rows, so search/selection/rendering
	// don't need to branch on `tab` themselves.
	const rows: Row[] = useMemo(
		() =>
			tab === "skills"
				? skills.map((skill) => ({
					key: skill.name,
					label: `/${skill.name}`,
					description: skill.description,
					run: () => {
						onOpenChange(false);
						onRunSkill(skill);
					},
				}))
				: shortcuts.map((sc) => ({
					key: sc.id,
					label: shortcutLabel(sc),
					description: promptPreview(sc.prompt, 80),
					run: () => {
						onOpenChange(false);
						onRun(sc);
					},
				})),
		[tab, skills, shortcuts, onOpenChange, onRunSkill, onRun],
	);

	// Case-insensitive substring match on label + description — same
	// approach as the branch filter in AttachWorktreeModal. No fuzzy
	// matching lib in this repo; these lists are short enough that
	// substring is fine.
	const q = query.trim().toLowerCase();
	const results = useMemo(() => {
		if (!q) return rows;
		return rows.filter((r) =>
			`${r.label} ${r.description}`.toLowerCase().includes(q),
		);
	}, [rows, q]);

	// Reset to the default tab (and a clean search) on every open.
	useEffect(() => {
		if (!open) return;
		setTab("skills");
		setQuery("");
	}, [open]);

	// Keep the selection valid as the result set changes underneath it.
	useEffect(() => {
		setSelected(0);
	}, [query, tab]);
	useEffect(() => {
		setSelected((i) => Math.min(i, Math.max(results.length - 1, 0)));
	}, [results.length]);

	// Open-triggered async skills refresh: hydrate the shared store when it
	// lands, keep the stale list on failure. `stale` guards against the
	// modal closing (or reopening) before the invoke settles.
	useEffect(() => {
		if (!open) return;
		let stale = false;
		setRefreshing(true);
		window.claude
			.listSkills()
			.then((list) => {
				if (!stale) useSkillsStore.getState().hydrate(list);
			})
			.catch((err) => console.error("[ccw] skills refresh failed", err))
			.finally(() => {
				if (!stale) setRefreshing(false);
			});
		return () => {
			stale = true;
		};
	}, [open]);

	// Escape closes. Only bound while open, so it can't fight the
	// Create/Edit modals' own handlers (those open after this closes).
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onOpenChange(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onOpenChange]);

	return (
		<>
			{open ? (
				<div className="modal-backdrop" {...backdropProps}>
					<div
						className="modal-card"
						role="dialog"
						aria-modal="true"
						aria-labelledby="shortcuts-launcher-title"
						style={{
							width: "min(440px, calc(100vw - 32px))",
							maxHeight: "calc(100vh - 64px)",
							display: "flex",
							flexDirection: "column",
						}}
					>
						<h2
							id="shortcuts-launcher-title"
							className="modal-title"
							style={{ flexShrink: 0 }}
						>
							Skills & shortcuts
						</h2>

						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown") {
									e.preventDefault();
									setSelected((i) => Math.min(i + 1, results.length - 1));
								} else if (e.key === "ArrowUp") {
									e.preventDefault();
									setSelected((i) => Math.max(i - 1, 0));
								} else if (e.key === "Enter") {
									e.preventDefault();
									results[selected]?.run();
								}
							}}
							placeholder={
								tab === "skills" ? "Search skills…" : "Search shortcuts…"
							}
							autoFocus
							style={{
								flexShrink: 0,
								width: "100%",
								marginBottom: 10,
								background: T.surfaceLow,
								border: `0.5px solid ${T.border}`,
								borderRadius: 6,
								padding: "6px 9px",
								fontSize: 12.5,
								color: T.text,
								outline: "none",
								boxSizing: "border-box",
							}}
							onFocus={(e) => {
								e.currentTarget.style.borderColor = T.accentBorder;
							}}
							onBlur={(e) => {
								e.currentTarget.style.borderColor = T.border;
							}}
						/>

						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 10,
								marginBottom: 12,
								flexShrink: 0,
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
								<SegmentedToggle value={tab} onChange={setTab} />
								{refreshing ? (
									<span className="asyncy-btn-spinner" aria-hidden />
								) : null}
							</div>
							{tab === "skills" ? <RevealSkillsFolderButton /> : null}
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 6,
								flex: "0 1 auto",
								minHeight: 0,
								overflowY: "auto",
							}}
						>
							{results.length > 0 ? (
								results.map((row, i) => (
									<LauncherRow
										key={row.key}
										label={row.label}
										description={row.description}
										selected={i === selected}
										onSelect={() => setSelected(i)}
										onClick={row.run}
									/>
								))
							) : q ? (
								<div style={{ fontSize: 12.5, color: T.textDim }}>
									{tab === "skills"
										? `No skills match "${query.trim()}".`
										: `No shortcuts match "${query.trim()}".`}
								</div>
							) : tab === "skills" ? (
								refreshing ? null : (
									<div style={{ fontSize: 12.5, color: T.textDim }}>
										No skills in ~/.claude/skills
									</div>
								)
							) : (
								<div style={{ fontSize: 12.5, color: T.textDim }}>
									No shortcuts yet.
								</div>
							)}
						</div>

						{tab === "shortcuts" ? (
							<div className="modal-actions" style={{ flexShrink: 0 }}>
								{shortcuts.length > 0 ? (
									<button
										className="btn"
										onClick={() => {
											onOpenChange(false);
											setEditing(true);
										}}
									>
										Edit shortcuts
									</button>
								) : null}
								<button
									className="btn btn-primary"
									onClick={() => {
										onOpenChange(false);
										setCreating(true);
									}}
								>
									Create shortcut
								</button>
							</div>
						) : null}
					</div>
				</div>
			) : null}
			<CreateShortcutModal open={creating} onClose={() => setCreating(false)} />
			<EditShortcutsModal open={editing} onClose={() => setEditing(false)} />
		</>
	);
}

/**
 * Two-tab segmented toggle. A trimmed private copy of the pattern in
 * AttachWorktreeModal (which itself notes segmented toggles are
 * intentionally duplicated per modal) — surfaceLow trough, surfaceHi
 * thumb on the active side, no accent color.
 */
function SegmentedToggle({
	value,
	onChange,
}: {
	value: Tab;
	onChange: (t: Tab) => void;
}) {
	return (
		<div
			role="tablist"
			style={{
				display: "inline-flex",
				alignSelf: "flex-start",
				background: T.surfaceLow,
				border: `0.5px solid ${T.border}`,
				borderRadius: 7,
				padding: 2,
				gap: 2,
			}}
		>
			<SegmentedItem
				label="Skills"
				active={value === "skills"}
				onClick={() => onChange("skills")}
			/>
			<SegmentedItem
				label="Shortcuts"
				active={value === "shortcuts"}
				onClick={() => onChange("shortcuts")}
			/>
		</div>
	);
}

function SegmentedItem({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				appearance: "none",
				border: "none",
				background: active ? T.surfaceHi : hover ? T.surface : "transparent",
				color: active ? T.text : T.textDim,
				fontSize: 11.5,
				fontWeight: active ? 600 : 500,
				padding: "5px 10px",
				borderRadius: 5,
				cursor: "pointer",
				transition: "background 80ms ease, color 80ms ease",
			}}
		>
			{label}
		</button>
	);
}

/**
 * Reveals `~/.claude/skills` in Finder: opens the enclosing `~/.claude`
 * folder with `skills` selected, rather than navigating into it.
 * Deliberately unlabeled and nearly invisible at rest (a dim glyph, no
 * border, no background) — this is a power-user escape hatch, not a
 * primary action, and the modal shouldn't visually advertise "here's a
 * filesystem button." It only exists on the Skills tab, since that's the
 * folder it reveals.
 */
function RevealSkillsFolderButton() {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			aria-label="Reveal skills folder in Finder"
			onClick={() => {
				window.claude
					.openSkillsFolder()
					.catch((err) => console.error("[ccw] open skills folder failed", err));
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: 20,
				height: 20,
				border: "none",
				background: "transparent",
				padding: 0,
				color: T.textDim,
				opacity: hover ? 0.85 : 0.2,
				cursor: "pointer",
				transition: "opacity 150ms ease",
			}}
		>
			<svg width="12" height="12" viewBox="0 0 14 14" fill="none">
				<path
					d="M1.5 3.6a1 1 0 0 1 1-1h2.6l1 1.2h4.4a1 1 0 0 1 1 1v4.9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3.6z"
					stroke="currentColor"
					strokeWidth="1.1"
					strokeLinejoin="round"
					fill="none"
				/>
			</svg>
		</button>
	);
}

/**
 * Clickable run-row shared by both tabs: bold label line plus a dimmed
 * one-line description. Same bordered-card hover treatment as
 * EditShortcutsModal's ShortcutRow, minus the inline delete affordance
 * (management lives behind "Edit shortcuts").
 */
function LauncherRow({
	label,
	description,
	selected,
	onSelect,
	onClick,
}: {
	label: string;
	description: string;
	selected: boolean;
	onSelect: () => void;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	const ref = useRef<HTMLButtonElement>(null);

	// Keep the keyboard-selected row in view as Up/Down scrolls a long list.
	useEffect(() => {
		if (selected) ref.current?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const active = hover || selected;
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			onMouseEnter={() => {
				setHover(true);
				onSelect();
			}}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "stretch",
				gap: 2,
				width: "100%",
				textAlign: "left",
				padding: "7px 10px",
				border: `0.5px solid ${active ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: active ? T.surfaceHi : T.surface,
				cursor: "pointer",
				transition: "background 80ms ease, border-color 80ms ease",
			}}
		>
			<span
				style={{
					fontSize: 13,
					fontWeight: 600,
					color: T.text,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
				}}
			>
				{label}
			</span>
			{description ? (
				<span
					style={{
						fontSize: 11.5,
						color: T.textDim,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						minWidth: 0,
					}}
				>
					{description}
				</span>
			) : null}
		</button>
	);
}
