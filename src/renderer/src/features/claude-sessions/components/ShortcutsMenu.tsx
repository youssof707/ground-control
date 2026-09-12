import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import { useSkillsStore } from "../stores/useSkillsStore";
import { shortcutLabel } from "./ShortcutForm";
import { CreateShortcutModal } from "./CreateShortcutModal";
import { EditShortcutsModal } from "./EditShortcutsModal";

type Tab = "skills" | "shortcuts";

type Row = {
	key: string;
	label: string;
	/** Slash-command labels (skills) render in mono; shortcut titles don't. */
	mono?: boolean;
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
 *   list renders immediately with a spinner beside the title while the
 *   refresh is in flight (never block on disk).
 * - "Shortcuts": the saved reusable prompts, with the create/edit entry
 *   points living inside the modal. Create/Edit close this modal before
 *   opening theirs (no stacked backdrops or dueling Escape handlers).
 *
 * Rows are single-line labels only. Skill descriptions and shortcut prompt
 * previews are deliberately not shown: they're long enough that they always
 * truncated mid-sentence, which doubled every row's height for no signal.
 * Geometry is fixed — the list viewport has a floor and a ceiling, and the
 * footer renders on both tabs — so the card never jumps or collapses.
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
					mono: true,
					run: () => {
						onOpenChange(false);
						onRunSkill(skill);
					},
				}))
				: shortcuts.map((sc) => ({
					key: sc.id,
					label: shortcutLabel(sc),
					run: () => {
						onOpenChange(false);
						onRun(sc);
					},
				})),
		[tab, skills, shortcuts, onOpenChange, onRunSkill, onRun],
	);

	// Case-insensitive substring match on the label — same approach as the
	// branch filter in AttachWorktreeModal. No fuzzy matching lib in this
	// repo; these lists are short enough that substring is fine.
	const q = query.trim().toLowerCase();
	const results = useMemo(() => {
		if (!q) return rows;
		return rows.filter((r) => r.label.toLowerCase().includes(q));
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
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 10,
								marginBottom: 10,
								flexShrink: 0,
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
								<h2
									id="shortcuts-launcher-title"
									className="modal-title"
									style={{ margin: 0 }}
								>
									Skills & shortcuts
								</h2>
								{refreshing ? (
									<span className="asyncy-btn-spinner" aria-hidden />
								) : null}
							</div>
							<SegmentedToggle value={tab} onChange={setTab} />
						</div>

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
								marginBottom: 8,
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

						{/*
						 * Fixed viewport: a one-result search (or a single saved
						 * shortcut) must not collapse the card, and a long skills
						 * list must not stretch it.
						 */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 1,
								flex: "1 1 auto",
								minHeight: 180,
								maxHeight: "min(46vh, 340px)",
								overflowY: "auto",
							}}
						>
							{results.length > 0 ? (
								results.map((row, i) => (
									<LauncherRow
										key={row.key}
										label={row.label}
										mono={row.mono}
										selected={i === selected}
										onSelect={() => setSelected(i)}
										onClick={row.run}
									/>
								))
							) : q ? (
								<EmptyState>
									{tab === "skills"
										? `No skills match "${query.trim()}".`
										: `No shortcuts match "${query.trim()}".`}
								</EmptyState>
							) : tab === "skills" ? (
								refreshing ? null : (
									<EmptyState>No skills in ~/.claude/skills</EmptyState>
								)
							) : (
								<EmptyState>No shortcuts yet.</EmptyState>
							)}
						</div>

						{/*
						 * Footer is present on both tabs so the card doesn't jump
						 * height when you switch between them.
						 */}
						<div
							className="modal-actions"
							style={{
								flexShrink: 0,
								marginTop: 10,
								paddingTop: 10,
								borderTop: `0.5px solid ${T.borderSoft}`,
							}}
						>
							{tab === "skills" ? (
								<button
									className="btn"
									onClick={() => {
										window.claude
											.openSkillsFolder()
											.catch((err) =>
												console.error("[ccw] open skills folder failed", err),
											);
									}}
								>
									Open skills folder
								</button>
							) : (
								<>
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
								</>
							)}
						</div>
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

/** Centered placeholder filling the fixed list viewport. */
function EmptyState({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				fontSize: 12.5,
				color: T.textMute,
			}}
		>
			{children}
		</div>
	);
}

/**
 * Clickable run-row shared by both tabs: a single flat line of text, no
 * border and no description. Deliberately *not* the bordered-card
 * treatment used by EditShortcutsModal's ShortcutRow — this is a palette
 * you scan and filter, so rows read as a list rather than a stack of
 * boxes, and hover/selection is carried by an accent-tinted fill alone.
 */
function LauncherRow({
	label,
	mono,
	selected,
	onSelect,
	onClick,
}: {
	label: string;
	mono?: boolean;
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
				display: "block",
				width: "100%",
				textAlign: "left",
				padding: "6px 9px",
				border: "none",
				borderRadius: 6,
				background: active ? T.accentSoft : "transparent",
				color: active ? T.text : T.textDim,
				fontFamily: mono ? T.mono : T.sans,
				fontSize: 12.5,
				fontWeight: 500,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				cursor: "pointer",
				transition: "background 80ms ease, color 80ms ease",
			}}
		>
			{label}
		</button>
	);
}
