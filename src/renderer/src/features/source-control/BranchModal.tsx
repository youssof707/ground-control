import {
	useCallback,
	useDeferredValue,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { ScmBranch } from "@shared/schemas/source_control";
import { useBackdropDismiss } from "../../components/useBackdropDismiss";
import { T } from "../../design/tokens";
import { CloseIcon } from "../claude-sessions/components/TerminalModal";
import { useSessionsStore } from "../claude-sessions/stores/useSessionsStore";
import { markCurrentBranch, refreshBranches, branchListFor, useBranchStore } from "./branchCache";
import { indexBranches, searchBranches } from "./branchSearch";
import { leafName, plural, shortAge } from "./format";
import { CopyButton } from "./CopyButton";
import { call } from "./scmClient";
import { WorktreesIcon } from "./SourceControlWidget";
import {
	requestRefresh,
	useSourceControlStore,
	type BranchModalTarget,
} from "./useSourceControlStore";

const RESULT_LIMIT = 300;
const PAGE_STEP = 10;

export function BranchIcon({ size = 11 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<circle cx="3" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1" />
			<circle cx="3" cy="9.5" r="1.3" stroke="currentColor" strokeWidth="1" />
			<circle cx="9" cy="3.5" r="1.3" stroke="currentColor" strokeWidth="1" />
			<path d="M3 4v4M3 8c0-2 6-2 6-4" stroke="currentColor" strokeWidth="1" fill="none" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M2.5 6.2L5 8.6L9.5 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function newBranchName(query: string, branches: readonly ScmBranch[]): string | null {
	const name = query.trim();
	if (!name || /\s/.test(name) || name.startsWith("-")) return null;
	const taken = branches.some(
		(b) => b.name === name || (b.remote !== null && b.name.slice(b.remote.length + 1) === name),
	);
	return taken ? null : name;
}

export function BranchModalHost() {
	const target = useSourceControlStore((s) => s.branchModal);
	const close = useSourceControlStore((s) => s.closeBranches);
	if (!target) return null;
	return createPortal(
		<BranchModal key={`${target.sessionId}:${target.checkout}`} target={target} onClose={close} />,
		document.body,
	);
}

function BranchModal({ target, onClose }: { target: BranchModalTarget; onClose: () => void }) {
	const { checkout, sessionId } = target;
	const sessionBranch = useSessionsStore((s) => s.sessions[sessionId]?.branch);
	const lastUserMessageBranch = useSessionsStore((s) => s.sessions[sessionId]?.lastUserMessageBranch);
	const worktreeName = useSourceControlStore(
		(s) => s.byCheckout[checkout]?.summary?.worktreeName ?? null,
	);
	const list = useBranchStore((s) => s.lists[checkout]);
	const loading = useBranchStore((s) => s.loading[checkout] ?? false);
	const loadError = useBranchStore((s) => s.errors[checkout]);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const [active, setActive] = useState(0);
	const [switching, setSwitching] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const baseId = useId();
	const backdropProps = useBackdropDismiss(onClose);

	useEffect(() => {
		branchListFor(checkout);
		void refreshBranches(checkout);
	}, [checkout]);

	const current = (sessionBranch && sessionBranch !== "HEAD" ? sessionBranch : null) ?? list?.current ?? null;
	const name = worktreeName ?? list?.worktreeName ?? null;
	const index = useMemo(() => indexBranches(list?.branches ?? [], current), [list, current]);
	const matches = useMemo(() => searchBranches(index, deferredQuery, RESULT_LIMIT), [index, deferredQuery]);
	const items = matches.items;
	const createName = useMemo(() => newBranchName(deferredQuery, list?.branches ?? []), [deferredQuery, list]);
	const offset = createName ? 1 : 0;
	const rowCount = items.length + offset;
	const firstRow = createName && items.length > 0 ? 1 : 0;

	useEffect(() => {
		setActive(firstRow);
		listRef.current?.scrollTo({ top: 0 });
	}, [deferredQuery, firstRow]);

	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>(`[data-index="${active}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onKeyDown = (e: globalThis.KeyboardEvent): void => {
			if (e.key !== "Escape" || e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		const onFocusIn = (e: FocusEvent): void => {
			const card = cardRef.current;
			if (card && e.target instanceof Node && !card.contains(e.target)) inputRef.current?.focus();
		};
		window.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("focusin", onFocusIn);
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("focusin", onFocusIn);
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [onClose]);

	const choose = useCallback(
		(branch: ScmBranch | undefined, create = false) => {
			if (!branch || switching) return;
			if (!create && !branch.remote && branch.name === current) {
				onClose();
				return;
			}
			setError(null);
			setSwitching(branch.name);
			void call<"switch">({ t: "switch", checkout, branch: branch.name, remote: branch.remote !== null, create })
				.promise.then(async (reply) => {
					requestRefresh(checkout, true);
					if (!reply.ok) {
						setSwitching(null);
						setError(reply.message || (create ? "Couldn't create the branch." : "Couldn't switch branches."));
						return;
					}
					const local = branch.remote ? branch.name.slice(branch.remote.length + 1) : branch.name;
					markCurrentBranch(checkout, local);
					void refreshBranches(checkout);
					await window.claude.refreshBranch(sessionId).catch(() => undefined);
					onClose();
				});
		},
		[checkout, current, onClose, sessionId, switching],
	);

	const create = useCallback(() => {
		if (createName) choose({ name: createName, remote: null, date: 0, worktree: null }, true);
	}, [choose, createName]);

	const chooseRow = (row: number): void => {
		if (createName && row === 0) create();
		else choose(items[row - offset]?.branch);
	};

	const previous =
		lastUserMessageBranch && sessionBranch && lastUserMessageBranch !== sessionBranch ? lastUserMessageBranch : null;

	const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
		const last = rowCount - 1;
		if (last < 0) return;
		const moves: Record<string, number> = {
			ArrowDown: Math.min(last, active + 1),
			ArrowUp: Math.max(0, active - 1),
			PageDown: Math.min(last, active + PAGE_STEP),
			PageUp: Math.max(0, active - PAGE_STEP),
		};
		if (e.key in moves) {
			e.preventDefault();
			setActive(moves[e.key]);
		} else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
			e.preventDefault();
			chooseRow(active);
		}
	};

	const total = list?.branches.length ?? 0;
	let status: string;
	if (!list) status = loading ? "Loading branches…" : "";
	else if (deferredQuery.trim()) {
		status =
			matches.total > items.length
				? `Top ${items.length.toLocaleString("en-US")} of ${plural(matches.total, "match", "matches")}`
				: plural(matches.total, "match", "matches");
	} else {
		status = plural(total, "branch", "branches");
	}

	let body;
	if (!list && loading) {
		body = (
			<div className="branch-empty">
				<span className="asyncy-btn-spinner" aria-hidden="true" />
				Loading branches…
			</div>
		);
	} else if (!list && loadError) {
		body = (
			<div className="branch-empty">
				<span>{loadError === "not-a-repo" ? "Not a git repository." : "Couldn't read branches."}</span>
				<button type="button" className="btn" onClick={() => void refreshBranches(checkout)}>
					Try again
				</button>
			</div>
		);
	} else if (rowCount === 0) {
		body = <div className="branch-empty">{query.trim() ? "No matching branches" : "No branches"}</div>;
	} else {
		const now = Date.now();
		const createRow = createName ? (
			<div
				key="create"
				id={`${baseId}-0`}
				data-index={0}
				role="option"
				aria-selected={active === 0}
				aria-busy={switching === createName || undefined}
				className="branch-row"
				onMouseMove={() => {
					if (active !== 0) setActive(0);
				}}
				onMouseDown={(e) => e.preventDefault()}
				onClick={create}
			>
				<span className="branch-row-check">
					<PlusIcon />
				</span>
				<span className="branch-row-name">
					<span className="branch-row-remote">Create </span>
					{createName}
				</span>
				<span className="branch-row-age">
					{switching === createName ? <span className="asyncy-btn-spinner" aria-label="Creating" /> : null}
				</span>
			</div>
		) : null;
		const rows = items.map((item, index) => {
			const i = index + offset;
			const branch = item.branch;
			const isCurrent = !branch.remote && branch.name === current;
			const prefix = branch.remote ? `${branch.remote}/` : "";
			const short = branch.name.slice(prefix.length);
			const elsewhere =
				!isCurrent && branch.worktree ? leafName(branch.worktree) : null;
			const busy = switching === branch.name;
			return (
				<div
					key={`${branch.remote ? "r" : "l"}:${branch.name}`}
					id={`${baseId}-${i}`}
					data-index={i}
					role="option"
					aria-selected={i === active}
					aria-current={isCurrent || undefined}
					aria-busy={busy || undefined}
					className="branch-row"
					onMouseMove={() => {
						if (i !== active) setActive(i);
					}}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => choose(branch)}
				>
					<span className="branch-row-check">{isCurrent ? <CheckIcon /> : null}</span>
					<span className="branch-row-name">
						{prefix ? <span className="branch-row-remote">{prefix}</span> : null}
						{short}
					</span>
					{elsewhere ? (
						<span className="branch-row-tag">
							<WorktreesIcon size={10} />
							{elsewhere}
						</span>
					) : null}
					<span className="branch-row-age">
						{busy ? <span className="asyncy-btn-spinner" aria-label="Switching" /> : shortAge(branch.date, now)}
					</span>
				</div>
			);
		});
		body = (
			<>
				{createRow}
				{rows}
			</>
		);
	}

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				ref={cardRef}
				className="modal-card branch-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Branches"
			>
				<div className="branch-head">
					<div className="branch-head-refs">
						{name ? (
							<>
								<span className="branch-head-ref">
									<WorktreesIcon size={12} />
									<span className="branch-head-text">{name}</span>
								</span>
								<span className="scm-widget-sep" aria-hidden="true">·</span>
							</>
						) : null}
						<span className="branch-head-ref branch-head-branch">
							<BranchIcon size={12} />
							<span className="branch-head-text">{current ?? "Detached HEAD"}</span>
						</span>
					</div>
					{current ? <CopyButton text={current} label={`Copy branch name ${current}`} /> : null}
					<button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
						<CloseIcon />
					</button>
				</div>
				<div className="branch-search">
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onInputKeyDown}
						placeholder="Switch to or create branch…"
						spellCheck={false}
						autoCorrect="off"
						autoCapitalize="off"
						role="combobox"
						aria-expanded="true"
						aria-controls={`${baseId}-list`}
						aria-activedescendant={rowCount > 0 ? `${baseId}-${active}` : undefined}
						aria-label="Search branches"
					/>
					{loading && list ? <span className="asyncy-btn-spinner" aria-label="Refreshing branches" /> : null}
				</div>
				{previous ? (
					<div className="branch-previous">
						<span>Previously working on {previous}</span>
						<button
							type="button"
							className="btn"
							disabled={switching !== null}
							onClick={() => choose({ name: previous, remote: null, date: 0, worktree: null })}
						>
							{switching === previous ? <span className="asyncy-btn-spinner" aria-hidden="true" /> : null}
							Switch back
						</button>
					</div>
				) : null}
				{error ? (
					<div className="branch-error" role="alert">
						<span>{error}</span>
						<button type="button" className="btn btn-ghost btn-icon" aria-label="Dismiss error" onClick={() => setError(null)}>
							<CloseIcon />
						</button>
					</div>
				) : null}
				<div ref={listRef} id={`${baseId}-list`} className="branch-list" role="listbox" aria-label="Branches">
					{body}
				</div>
				<div className="branch-foot" aria-live="polite">
					<span>{status}</span>
					<span style={{ color: T.textFaint }}>
						{createName && active === 0 ? "↵ create" : "↵ switch"} · esc close
					</span>
				</div>
			</div>
		</div>
	);
}
