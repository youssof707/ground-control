import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { T } from "../../../design/tokens";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import { useSkillsStore } from "../stores/useSkillsStore";
import { promptPreview, shortcutLabel } from "./ShortcutForm";
import { CreateShortcutModal } from "./CreateShortcutModal";
import { EditShortcutsModal } from "./EditShortcutsModal";

type Tab = "skills" | "shortcuts";

/**
 * The single shortcuts ⚡ launcher, used both by the sidebar (where running
 * an entry starts a new session) and by the composer footer (where running
 * an entry inserts into the session you're already in). Clicking the bolt
 * opens a two-tab modal:
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
	const [tab, setTab] = useState<Tab>("skills");
	const [refreshing, setRefreshing] = useState(false);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);

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

	// Reset to the default tab on every open.
	useEffect(() => {
		if (!open) return;
		setTab("skills");
	}, [open]);

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
				setOpen(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open]);

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
			{open ? (
				<div
					className="modal-backdrop"
					onClick={() => setOpen(false)}
					role="presentation"
				>
					<div
						className="modal-card"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="shortcuts-launcher-title"
						style={{ width: "min(440px, calc(100vw - 32px))" }}
					>
						<h2 id="shortcuts-launcher-title" className="modal-title">
							Skills & shortcuts
						</h2>

						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								marginBottom: 12,
							}}
						>
							<SegmentedToggle value={tab} onChange={setTab} />
							{refreshing ? (
								<span className="asyncy-btn-spinner" aria-hidden />
							) : null}
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 6,
								maxHeight: "min(50vh, 360px)",
								overflowY: "auto",
							}}
						>
							{tab === "skills" ? (
								skills.length > 0 ? (
									skills.map((skill) => (
										<LauncherRow
											key={skill.name}
											label={`/${skill.name}`}
											description={skill.description}
											onClick={() => {
												setOpen(false);
												onRunSkill(skill);
											}}
										/>
									))
								) : refreshing ? null : (
									<div style={{ fontSize: 12.5, color: T.textDim }}>
										No skills in ~/.claude/skills
									</div>
								)
							) : shortcuts.length > 0 ? (
								shortcuts.map((sc) => (
									<LauncherRow
										key={sc.id}
										label={shortcutLabel(sc)}
										description={promptPreview(sc.prompt, 80)}
										onClick={() => {
											setOpen(false);
											onRun(sc);
										}}
									/>
								))
							) : (
								<div style={{ fontSize: 12.5, color: T.textDim }}>
									No shortcuts yet.
								</div>
							)}
						</div>

						{tab === "shortcuts" ? (
							<div className="modal-actions">
								{shortcuts.length > 0 ? (
									<button
										className="btn"
										onClick={() => {
											setOpen(false);
											setEditing(true);
										}}
									>
										Edit shortcuts
									</button>
								) : null}
								<button
									className="btn btn-primary"
									onClick={() => {
										setOpen(false);
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
 * Clickable run-row shared by both tabs: bold label line plus a dimmed
 * one-line description. Same bordered-card hover treatment as
 * EditShortcutsModal's ShortcutRow, minus the inline delete affordance
 * (management lives behind "Edit shortcuts").
 */
function LauncherRow({
	label,
	description,
	onClick,
}: {
	label: string;
	description: string;
	onClick: () => void;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "stretch",
				gap: 2,
				width: "100%",
				textAlign: "left",
				padding: "7px 10px",
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: hover ? T.surfaceHi : T.surface,
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
