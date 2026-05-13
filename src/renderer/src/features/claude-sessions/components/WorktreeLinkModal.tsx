import { useEffect, useState } from "react";
import type { Worktree } from "@shared/schemas/worktree";
import { T } from "../../../design/tokens";

interface Props {
	open: boolean;
	/** Source folder the user picked when creating the draft session.
	 * The modal lists worktrees scoped to this folder's repo and uses it
	 * as the base for `git worktree add`. */
	cwd: string;
	/**
	 * Called when the user picks either "create new" or an existing
	 * worktree. The parent (SessionChat) runs the promotion flow:
	 * `session:start({ cwd, worktree: choice })` → real session → URL
	 * swap. Throw to surface the error inline in the modal.
	 */
	onPick: (
		choice:
			| { kind: "new"; branch: string }
			| { kind: "existing"; worktreeId: string },
	) => Promise<void>;
	onClose: () => void;
}

/**
 * Modal opened from the worktree chip in an ephemeral draft session.
 * Lets the user either create a brand-new worktree off `origin`'s
 * default branch, or link to an existing worktree filtered to the
 * picked folder's repo. Either path triggers the parent's `onPick`
 * callback, which promotes the draft into a real session in the
 * chosen worktree.
 *
 * The mid-session linking flow no longer exists (the SDK loop bakes
 * cwd in at spawn, so post-creation cwd swaps don't work cleanly).
 * This modal is therefore only reachable from ephemeral drafts.
 */
export function WorktreeLinkModal({ open, cwd, onPick, onClose }: Props) {
	const [list, setList] = useState<Worktree[]>([]);
	const [notARepo, setNotARepo] = useState(false);
	const [baseRef, setBaseRef] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [branch, setBranch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Reset state every time the modal opens. Hydrate the existing-list +
	// base-ref hint against the source `cwd` (the picked folder, NOT the
	// future worktree path).
	useEffect(() => {
		if (!open) return;
		setError(null);
		setBranch("");
		setLoading(true);
		(async () => {
			try {
				const [result, peeked] = await Promise.all([
					window.claude.listWorktreesForCwd(cwd),
					window.claude.peekWorktreeBaseRefForCwd(cwd),
				]);
				setList(result.items);
				setNotARepo(result.notARepo);
				setBaseRef(peeked);
			} catch (err) {
				setError((err as Error).message);
			} finally {
				setLoading(false);
			}
		})();
	}, [open, cwd]);

	// ESC closes the modal. Enter is captured by the input below to
	// trigger Create + Link directly.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !busy) onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, busy, onClose]);

	if (!open) return null;

	const disabled = busy;

	async function createAndLink() {
		if (disabled) return;
		const trimmed = branch.trim();
		if (!trimmed) {
			setError("Enter a branch name.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await onPick({ kind: "new", branch: trimmed });
			onClose();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function linkExisting(worktreeId: string) {
		if (disabled) return;
		setBusy(true);
		setError(null);
		try {
			await onPick({ kind: "existing", worktreeId });
			onClose();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			className="modal-backdrop"
			onClick={busy ? undefined : onClose}
			role="presentation"
		>
			<div
				className="modal-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="worktree-modal-title"
				style={{ width: "min(520px, calc(100vw - 32px))" }}
			>
				<h2 id="worktree-modal-title" className="modal-title">
					Link Worktree
				</h2>
				<div className="modal-message">
					Worktrees give this session an isolated working tree branched off
					your repo's default. Once linked, the session is locked to it for
					life — every message, edit, and git op runs in the worktree.
				</div>

				{notARepo ? (
					<div
						style={{
							marginBottom: 12,
							padding: "8px 10px",
							background: T.dangerSoft,
							color: T.danger,
							border: `0.5px solid ${T.dangerBorder}`,
							borderRadius: 6,
							fontSize: 12,
						}}
					>
						This folder isn't a git repository, so it can't host a worktree.
					</div>
				) : null}

				{error ? <div className="modal-error">{error}</div> : null}

				{/* ── Create new ──────────────────────────────────────────────── */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 28,
					}}
				>
					<div
						style={{
							display: "flex",
							gap: 8,
							alignItems: "center",
						}}
					>
						<input
							type="text"
							value={branch}
							onChange={(e) => setBranch(e.target.value)}
							placeholder="branch name (e.g. feature/login)"
							disabled={disabled || notARepo}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									void createAndLink();
								}
							}}
							style={{
								flex: 1,
								minWidth: 0,
								padding: "6px 9px",
								background: T.surface,
								border: `0.5px solid ${T.border}`,
								borderRadius: 6,
								color: T.text,
								fontFamily: T.mono,
								fontSize: 12.5,
								outline: "none",
							}}
						/>
						<button
							className="btn btn-primary"
							onClick={createAndLink}
							disabled={disabled || notARepo}
						>
							{busy ? "…" : "Create + Link"}
						</button>
					</div>
					<div
						style={{
							fontSize: 11.5,
							color: T.textFaint,
							fontFamily: T.mono,
						}}
					>
						Will branch off:{" "}
						<span style={{ color: T.textDim }}>
							{baseRef ?? (notARepo ? "(not a repo)" : "(unknown)")}
						</span>
					</div>
				</div>

				{/* ── Link existing ───────────────────────────────────────────── */}
				{/* Hidden entirely until at least one worktree exists for this
				    repo. An empty "Or link an existing worktree" + "No worktrees
				    yet" placeholder adds noise without value, since the Create
				    form above is the only actionable path in that state. */}
				{!loading && list.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 6,
							marginBottom: 12,
						}}
					>
						<div
							style={{
								fontSize: 11,
								color: T.textMute,
								textTransform: "uppercase",
								letterSpacing: 0.5,
							}}
						>
							Or link an existing worktree
						</div>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 4,
								maxHeight: 220,
								overflowY: "auto",
							}}
						>
							{list.map((w) => (
								<button
									key={w.id}
									type="button"
									onClick={() => void linkExisting(w.id)}
									disabled={disabled}
									title={`${w.path}\nBranched off ${w.baseRef}`}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										padding: "8px 10px",
										background: T.surface,
										border: `0.5px solid ${T.borderSoft}`,
										borderRadius: 6,
										color: T.text,
										fontSize: 12.5,
										textAlign: "left",
										cursor: disabled ? "not-allowed" : "pointer",
										transition:
											"background 0.12s, border-color 0.12s",
									}}
									onMouseEnter={(e) => {
										if (disabled) return;
										e.currentTarget.style.background = T.surfaceHi;
										e.currentTarget.style.borderColor = T.border;
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = T.surface;
										e.currentTarget.style.borderColor = T.borderSoft;
									}}
								>
									<span
										style={{
											fontFamily: T.mono,
											color: T.textDim,
											flexShrink: 0,
										}}
									>
										{w.branch}
									</span>
									<span
										style={{
											fontFamily: T.mono,
											color: T.textFaint,
											fontSize: 11,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											minWidth: 0,
										}}
									>
										{w.path}
									</span>
								</button>
							))}
						</div>
					</div>
				) : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose} disabled={busy}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}
