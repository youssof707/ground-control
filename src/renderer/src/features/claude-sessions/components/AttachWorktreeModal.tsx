import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { T } from "../../../design/tokens";
import type { LocalBranch, Worktree } from "@shared/schemas/worktrees";
import { useWorktreesStore } from "../stores/useWorktreesStore";

type CreateMode = "new-branch" | "existing-branch";

/**
 * Modal for attaching a worktree to a draft session. Renders three sections:
 *   1. Existing worktrees for the draft's baseDir — single-click to attach
 *      (reuses a previously-created checkout).
 *   2. Create-a-new-worktree form with a mode toggle:
 *        - "New branch": app runs `git worktree add -b <newBranch> <path>`.
 *        - "Existing branch": pick a local branch that isn't already
 *          checked out; app runs `git worktree add <path> <existingBranch>`.
 *
 * On success (any path), calls `onAttach(worktreeId)` and closes.
 *
 * Uses the same CSS classes as ConfirmModal (`modal-backdrop`,
 * `modal-card`, `modal-title`, `modal-actions`, `modal-error`) for
 * visual consistency, plus inline styles for the sections + form which
 * don't have a shared analogue elsewhere.
 *
 * Not a ConfirmModal wrapper: this modal owns form state, in-flight
 * IPC lifecycle, and per-row click handlers that ConfirmModal isn't
 * designed for.
 */
export function AttachWorktreeModal({
	open,
	baseDir,
	onAttach,
	onClose,
}: {
	open: boolean;
	baseDir: string;
	onAttach: (worktreeId: string) => void;
	onClose: () => void;
}) {
	const [existing, setExisting] = useState<Worktree[]>([]);
	const [baseBranch, setBaseBranch] = useState<string | undefined>(undefined);
	const [branches, setBranches] = useState<LocalBranch[]>([]);
	const [mode, setMode] = useState<CreateMode>("new-branch");
	const [displayName, setDisplayName] = useState("");
	const [newBranch, setNewBranch] = useState("");
	const [selectedBranch, setSelectedBranch] = useState<string>("");
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Cheap "monotonic seq" — drops stale IPC responses if the modal is
	// reopened with a different baseDir while the previous fetch was in
	// flight. Matches the seq pattern in useSessionsBootstrap.
	const fetchSeq = useRef(0);

	// Reset form + refetch when the modal opens (or baseDir changes while
	// open — shouldn't happen in practice, but keeps state honest).
	useEffect(() => {
		if (!open) return;
		setDisplayName("");
		setNewBranch("");
		setSelectedBranch("");
		setMode("new-branch");
		setError(null);
		setCreating(false);
		const my = ++fetchSeq.current;
		void (async () => {
			try {
				const [list, br, allBranches] = await Promise.all([
					window.claude.listWorktreesForBaseDir(baseDir),
					window.claude.getBaseBranch(baseDir),
					window.claude.listBranches(baseDir),
				]);
				if (my !== fetchSeq.current) return;
				setExisting(list);
				setBaseBranch(br);
				setBranches(allBranches);
			} catch (err) {
				if (my !== fetchSeq.current) return;
				console.error("[ccw] AttachWorktreeModal fetch failed:", err);
				setExisting([]);
				setBaseBranch(undefined);
				setBranches([]);
			}
		})();
	}, [open, baseDir]);

	// Refetch on `state:changed` while open so create/delete from other
	// windows show up here without needing a manual reopen. Also refresh
	// the branch list because a sibling worktree create/delete changes
	// which branches are "in use."
	useEffect(() => {
		if (!open) return;
		const off = window.claude.on("state:changed", () => {
			const my = ++fetchSeq.current;
			void (async () => {
				try {
					const [list, allBranches] = await Promise.all([
						window.claude.listWorktreesForBaseDir(baseDir),
						window.claude.listBranches(baseDir),
					]);
					if (my !== fetchSeq.current) return;
					setExisting(list);
					setBranches(allBranches);
				} catch {
					// keep the current lists
				}
			})();
		});
		return () => off();
	}, [open, baseDir]);

	// Escape closes; Enter submits when the create form is complete + focused
	// (any form input focused counts — we don't want Enter to fire when the
	// user is on an existing-row button, since those are single-click already).
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	const handleAttachExisting = useCallback(
		(id: string) => {
			// Row objects come from the freshly-refetched `existing` list,
			// so we can upsert into the store synchronously before flipping
			// the draft's `worktreeId`. Prevents a render tick where the
			// selector `worktrees[id]` is undefined and the parent falls
			// back to `<AddWorktreeButton>` instead of `<WorktreeChip>`.
			const row = existing.find((w) => w.id === id);
			if (row) useWorktreesStore.getState().upsert(row);
			onAttach(id);
			onClose();
		},
		[existing, onAttach, onClose],
	);

	// Delete an existing zero-session worktree from within the modal. The
	// row's own trash button drives the two-step confirm; this handler runs
	// only after the user has confirmed. Updates both the local `existing`
	// list (so the row disappears immediately) and the worktrees store (so
	// sidebar chips etc. drop the entry) — main's broadcast is skip-self.
	const handleDeleteExisting = useCallback(async (id: string) => {
		try {
			await window.claude.deleteWorktree(id);
			setExisting((prev) => prev.filter((w) => w.id !== id));
			useWorktreesStore.getState().remove(id);
			// Also refresh the branch list — the deleted worktree's branch
			// is now free again and should become selectable in the
			// "Existing branch" picker.
			try {
				const allBranches = await window.claude.listBranches(baseDir);
				setBranches(allBranches);
			} catch {
				// keep the current list
			}
		} catch (err) {
			// Surface at the modal's error slot rather than inside the row —
			// deletes fail rarely (only if a session raced onto it between
			// the trash button showing and the IPC firing) and the shared
			// slot is already how we render create errors.
			setError((err as Error).message || "Failed to delete worktree");
		}
	}, [baseDir]);

	// Sensible newBranch validation. Rejects leading `-` (which
	// `worktreeAdd` also refuses, but nicer to catch inline) and control
	// characters + spaces + a few characters git itself refuses.
	const branchInvalid = useMemo(() => {
		if (mode !== "new-branch") return null;
		const trimmed = newBranch.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith("-")) return "Branch name cannot start with '-'";
		if (/[\s~^:?*[\\]/.test(trimmed))
			return "Branch name contains invalid characters";
		return null;
	}, [mode, newBranch]);

	const canCreate = useMemo(() => {
		if (creating) return false;
		// displayName is optional — falls back to the branch name on submit.
		if (mode === "new-branch") {
			return newBranch.trim().length > 0 && !branchInvalid;
		}
		return selectedBranch.length > 0;
	}, [creating, mode, newBranch, branchInvalid, selectedBranch]);

	const handleCreate = useCallback(async () => {
		if (!canCreate) return;
		setCreating(true);
		setError(null);
		try {
			// Empty/whitespace displayName falls back to the branch name so
			// the user doesn't have to type the same thing twice for the
			// common case. Slugification (main-side) then produces the
			// on-disk folder name from whichever we end up with.
			const branchForFallback =
				mode === "new-branch" ? newBranch.trim() : selectedBranch;
			const effectiveDisplayName =
				displayName.trim() || branchForFallback;
			const input =
				mode === "new-branch"
					? {
						mode: "new-branch" as const,
						baseDir,
						displayName: effectiveDisplayName,
						newBranch: newBranch.trim(),
					}
					: {
						mode: "existing-branch" as const,
						baseDir,
						displayName: effectiveDisplayName,
						existingBranch: selectedBranch,
					};
			const wt = await window.claude.createWorktree(input);
			// Hydrate the local worktrees store immediately so the draft's
			// re-render (triggered by `onAttach` → `updateDraft`) can resolve
			// `worktreeId` → chip in the same tick. Main broadcasts
			// `state:changed` to other windows only (skip-self), so without
			// this upsert the originating window would keep showing the
			// "+ Add worktree" button until a reload.
			useWorktreesStore.getState().upsert(wt);
			onAttach(wt.id);
			onClose();
		} catch (err) {
			setError((err as Error).message || "Failed to create worktree");
			setCreating(false);
		}
	}, [
		baseDir,
		mode,
		displayName,
		newBranch,
		selectedBranch,
		canCreate,
		onAttach,
		onClose,
	]);

	if (!open) return null;

	return (
		<div className="modal-backdrop" onClick={onClose} role="presentation">
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="attach-worktree-title"
				style={{ width: "min(520px, calc(100vw - 32px))" }}
			>
				<h2 id="attach-worktree-title" className="modal-title">
					Add a worktree
				</h2>

				<div
					style={{
						fontSize: 12,
						color: T.textDim,
						marginBottom: 14,
						lineHeight: 1.5,
					}}
				>
					<div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
						<span style={{ color: T.textMute }}>Base repo:</span>
						<span
							style={{
								fontFamily: T.mono,
								color: T.text,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
							title={baseDir}
						>
							{baseDir.split("/").filter(Boolean).pop() ?? baseDir}
						</span>
					</div>
					{baseBranch ? (
						<div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
							<span style={{ color: T.textMute }}>Current branch:</span>
							<span style={{ fontFamily: T.mono, color: T.text }}>
								{baseBranch}
							</span>
						</div>
					) : null}
				</div>

				<Section title="Existing worktrees">
					{existing.length === 0 ? (
						<div
							style={{
								fontSize: 12,
								color: T.textFaint,
								padding: "6px 2px",
							}}
						>
							No worktrees exist for this repo yet.
						</div>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							{existing.map((wt) => (
								<ExistingRow
									key={wt.id}
									worktree={wt}
									onClick={() => handleAttachExisting(wt.id)}
									onDelete={() => handleDeleteExisting(wt.id)}
								/>
							))}
						</div>
					)}
				</Section>

				<Section title="Or create a new worktree">
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 10,
						}}
					>
						<SegmentedToggle
							value={mode}
							onChange={(m) => {
								setMode(m);
								setError(null);
							}}
							disabled={creating}
						/>
						<LabeledInput
							label="Display name"
							value={displayName}
							onChange={setDisplayName}
							autoFocus
							disabled={creating}
							maxLength={60}
						/>
						{mode === "new-branch" ? (
							<LabeledInput
								label="New branch"
								value={newBranch}
								onChange={setNewBranch}
								disabled={creating}
								maxLength={200}
								hint={
									branchInvalid ??
									(baseBranch
										? `Branching off \`${baseBranch}\`.`
										: "Branching off the current branch.")
								}
								hintError={!!branchInvalid}
								onEnter={handleCreate}
							/>
						) : (
							<BranchPicker
								branches={branches}
								baseDir={baseDir}
								selected={selectedBranch}
								onSelect={setSelectedBranch}
								disabled={creating}
							/>
						)}
					</div>
				</Section>

				{error ? <div className="modal-error">{error}</div> : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose} disabled={creating}>
						Cancel
					</button>
					<button
						className="btn btn-primary"
						disabled={!canCreate}
						onClick={handleCreate}
					>
						{creating ? "…" : "Create & attach"}
					</button>
				</div>
			</div>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div style={{ marginBottom: 16 }}>
			<div
				style={{
					fontSize: 10.5,
					fontWeight: 600,
					letterSpacing: 0.6,
					textTransform: "uppercase",
					color: T.textMute,
					marginBottom: 8,
				}}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

function ExistingRow({
	worktree,
	onClick,
	onDelete,
}: {
	worktree: Worktree;
	onClick: () => void;
	onDelete: () => void;
}) {
	const [hover, setHover] = useState(false);
	const sessionCount = worktree.sessionIds.length;
	const canDelete = sessionCount === 0;
	// Outer is a role="button" div rather than a real <button> so we can
	// nest an actual <button> (the trash) inside it — nested <button>s are
	// invalid HTML. Keyboard support (Enter/Space) is preserved manually.
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				textAlign: "left",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "6px 6px 6px 10px",
				border: `0.5px solid ${hover ? T.accentBorder : T.border}`,
				borderRadius: 8,
				background: hover ? T.surfaceHi : T.surface,
				color: T.text,
				cursor: "pointer",
				fontSize: 12.5,
				transition: "background 80ms ease, border-color 80ms ease",
				outline: "none",
			}}
		>
			<span
				style={{
					fontWeight: 600,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					minWidth: 0,
					flex: 1,
				}}
			>
				{worktree.displayName}
			</span>
			<span
				style={{
					fontFamily: T.mono,
					fontSize: 11,
					color: T.textDim,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					maxWidth: 200,
				}}
				title={worktree.branch}
			>
				{worktree.branch}
			</span>
			<span
				style={{
					fontSize: 11,
					color: T.textMute,
					flexShrink: 0,
				}}
			>
				{sessionCount} session{sessionCount === 1 ? "" : "s"}
			</span>
			{canDelete ? <DeleteWorktreeButton onDelete={onDelete} /> : null}
		</div>
	);
}

const CONFIRM_REVERT_MS = 3000;

/**
 * Two-step delete confirmation matching NoteCard's pattern verbatim:
 * trash icon by default, click reveals a "Confirm delete?" pill styled
 * with the danger tokens, click again fires the delete. 3-second timeout
 * reverts to the icon if the user doesn't follow through. Clicks are
 * stopped from bubbling so hitting the trash doesn't also fire the row's
 * attach handler.
 */
function DeleteWorktreeButton({ onDelete }: { onDelete: () => void }) {
	const [confirming, setConfirming] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);
	const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		if (!confirming) {
			setConfirming(true);
			timerRef.current = setTimeout(() => {
				setConfirming(false);
				timerRef.current = null;
			}, CONFIRM_REVERT_MS);
			return;
		}
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setConfirming(false);
		onDelete();
	};
	if (confirming) {
		return (
			<button
				type="button"
				onClick={handleClick}
				aria-label="Confirm delete worktree"
				style={{
					padding: "4px 10px",
					borderRadius: 6,
					border: `0.5px solid ${T.dangerBorder}`,
					background: T.dangerSoft,
					color: T.danger,
					fontSize: 11.5,
					fontWeight: 500,
					fontFamily: T.sans,
					lineHeight: 1.2,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				Confirm delete?
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={handleClick}
			aria-label="Delete worktree"
			title="Delete worktree"
			style={{
				width: 24,
				height: 24,
				padding: 0,
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.textMute,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
				flexShrink: 0,
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<path
					d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M6 6v4M8 6v4"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}

/**
 * Two-position segmented toggle for the create-mode switch. Visual style
 * matches the app's chip/toolbar vocabulary — surfaceLow trough with a
 * surfaceHi thumb on the active side, no accent color (that would clash
 * with the "Create & attach" primary at the bottom of the modal).
 */
function SegmentedToggle({
	value,
	onChange,
	disabled,
}: {
	value: CreateMode;
	onChange: (m: CreateMode) => void;
	disabled?: boolean;
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
				label="New branch"
				active={value === "new-branch"}
				onClick={() => onChange("new-branch")}
				disabled={disabled}
			/>
			<SegmentedItem
				label="Existing branch"
				active={value === "existing-branch"}
				onClick={() => onChange("existing-branch")}
				disabled={disabled}
			/>
		</div>
	);
}

function SegmentedItem({
	label,
	active,
	onClick,
	disabled,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	disabled?: boolean;
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
			disabled={disabled}
			style={{
				appearance: "none",
				border: "none",
				background: active
					? T.surfaceHi
					: hover
						? T.surface
						: "transparent",
				color: active ? T.text : T.textDim,
				fontSize: 11.5,
				fontWeight: active ? 600 : 500,
				padding: "5px 10px",
				borderRadius: 5,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
				transition: "background 80ms ease, color 80ms ease",
			}}
		>
			{label}
		</button>
	);
}

/**
 * Scrollable list of local branches for the "Existing branch" mode.
 * Rows whose branch is already checked out somewhere (base repo or a
 * sibling app-owned worktree) are disabled with a hint pointing at
 * the occupying checkout, since `git worktree add <path> <branch>`
 * refuses to reuse an already-checked-out branch.
 */
function BranchPicker({
	branches,
	baseDir,
	selected,
	onSelect,
	disabled,
}: {
	branches: LocalBranch[];
	baseDir: string;
	selected: string;
	onSelect: (name: string) => void;
	disabled?: boolean;
}) {
	const [search, setSearch] = useState("");
	// Case-insensitive substring match on branch name. No fuzzy matching
	// — branch lists are short enough that substring is fine and the
	// intent ("show me anything with `refactor` in it") maps naturally.
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return branches;
		return branches.filter((b) => b.name.toLowerCase().includes(q));
	}, [branches, search]);

	if (branches.length === 0) {
		return (
			<div
				style={{
					fontSize: 12,
					color: T.textFaint,
					padding: "6px 2px",
				}}
			>
				No local branches found.
			</div>
		);
	}
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<span
				style={{
					fontSize: 11,
					color: T.textDim,
					letterSpacing: 0.2,
				}}
			>
				Branch
			</span>
			<input
				type="text"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				disabled={disabled}
				aria-label="Search branches"
				style={{
					appearance: "none",
					background: T.surfaceLow,
					color: T.text,
					border: `0.5px solid ${T.border}`,
					borderRadius: 6,
					padding: "6px 9px",
					fontSize: 12.5,
					fontFamily: T.mono,
					outline: "none",
					transition: "border-color 80ms ease",
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
					flexDirection: "column",
					gap: 3,
					maxHeight: 220,
					overflow: "auto",
					padding: 2,
					border: `0.5px solid ${T.border}`,
					borderRadius: 6,
					background: T.surfaceLow,
				}}
			>
				{filtered.length === 0 ? (
					<div
						style={{
							fontSize: 12,
							color: T.textFaint,
							padding: "6px 8px",
							fontFamily: T.sans,
						}}
					>
						No branches match “{search.trim()}”.
					</div>
				) : (
					filtered.map((b) => (
						<BranchRow
							key={b.name}
							branch={b}
							baseDir={baseDir}
							selected={selected === b.name}
							onSelect={() => onSelect(b.name)}
							disabled={disabled}
						/>
					))
				)}
			</div>
		</div>
	);
}

function BranchRow({
	branch,
	baseDir,
	selected,
	onSelect,
	disabled,
}: {
	branch: LocalBranch;
	baseDir: string;
	selected: boolean;
	onSelect: () => void;
	disabled?: boolean;
}) {
	const [hover, setHover] = useState(false);
	const inUse = branch.worktreePath !== null;
	const isCurrent = inUse && branch.worktreePath === baseDir;
	// Clicks are only meaningful for free branches; git will refuse
	// to check out an already-used branch, so we disable those rows
	// entirely instead of surfacing the error after the round-trip.
	const clickable = !inUse && !disabled;
	return (
		<button
			type="button"
			onClick={clickable ? onSelect : undefined}
			onMouseEnter={() => clickable && setHover(true)}
			onMouseLeave={() => setHover(false)}
			disabled={!clickable}
			title={
				inUse
					? isCurrent
						? "Currently checked out in the base repo"
						: `In use by another worktree at ${branch.worktreePath}`
					: undefined
			}
			style={{
				appearance: "none",
				textAlign: "left",
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 8px",
				border: `0.5px solid ${
					selected ? T.accentBorder : "transparent"
				}`,
				borderRadius: 5,
				background: selected
					? T.accentSoft
					: hover
						? T.surface
						: "transparent",
				color: inUse ? T.textFaint : T.text,
				cursor: clickable ? "pointer" : "not-allowed",
				fontSize: 12.5,
				fontFamily: T.mono,
				opacity: inUse ? 0.55 : 1,
				transition: "background 80ms ease, border-color 80ms ease",
			}}
		>
			<span
				style={{
					flex: 1,
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{branch.name}
			</span>
			{inUse ? (
				<span
					style={{
						fontSize: 10.5,
						fontFamily: T.sans,
						color: T.textMute,
						flexShrink: 0,
					}}
				>
					{isCurrent ? "current branch" : "in use"}
				</span>
			) : null}
		</button>
	);
}

function LabeledInput({
	label,
	value,
	onChange,
	placeholder,
	autoFocus,
	disabled,
	maxLength,
	hint,
	hintError,
	onEnter,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	autoFocus?: boolean;
	disabled?: boolean;
	maxLength?: number;
	hint?: string;
	hintError?: boolean;
	onEnter?: () => void;
}) {
	return (
		<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<span
				style={{
					fontSize: 11,
					color: T.textDim,
					letterSpacing: 0.2,
				}}
			>
				{label}
			</span>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				disabled={disabled}
				autoFocus={autoFocus}
				maxLength={maxLength}
				onKeyDown={(e) => {
					if (e.key === "Enter" && onEnter) {
						e.preventDefault();
						onEnter();
					}
				}}
				style={{
					appearance: "none",
					background: T.surfaceLow,
					color: T.text,
					border: `0.5px solid ${T.border}`,
					borderRadius: 6,
					padding: "7px 9px",
					fontSize: 13,
					fontFamily: T.mono,
					outline: "none",
					transition: "border-color 80ms ease",
				}}
				onFocus={(e) => {
					e.currentTarget.style.borderColor = T.accentBorder;
				}}
				onBlur={(e) => {
					e.currentTarget.style.borderColor = T.border;
				}}
			/>
			{hint ? (
				<span
					style={{
						fontSize: 11,
						color: hintError ? T.danger : T.textFaint,
					}}
				>
					{hint}
				</span>
			) : null}
		</label>
	);
}
