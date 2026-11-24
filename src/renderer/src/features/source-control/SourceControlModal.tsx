import {
	Component,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ScmAction, ScmPick, ScmSummary, ScmWorktree } from "@shared/schemas/source_control";
import { ConfirmModal } from "../../components/ConfirmModal";
import { useBackdropDismiss } from "../../components/useBackdropDismiss";
import { T } from "../../design/tokens";
import { useWorktreesStore } from "../claude-sessions/stores/useWorktreesStore";
import { CloseIcon } from "../claude-sessions/components/TerminalModal";
import { appendPromptBlock, focusComposer } from "../claude-sessions/lib/composerActions";
import { CheckoutPicker, type PickerOption } from "./CheckoutPicker";
import { CommitModal } from "./CommitModal";
import { DiffPane, type DiffView } from "./DiffPane";
import { FileList, type FileListHandle, type FileListRows } from "./FileList";
import type { RowPointer } from "./FileRow";
import { ScmContextMenu, type MenuItem } from "./ScmContextMenu";
import { formatAge, leafName, plural } from "./format";
import { buildReviewPrompt } from "./reviewPrompt";
import {
	canReuse,
	createBuffer,
	fillRows,
	keyPath,
	keyStaged,
	locate,
	makeKey,
	rowKey,
	statusAt,
	type RowBuffer,
} from "./rowBuffer";
import { call, cancel, retryConnection } from "./scmClient";
import {
	commitStaged,
	isHardFailure,
	requestRefresh,
	useSourceControlStore,
	type ScmEntry,
} from "./useSourceControlStore";

const DIFF_DEBOUNCE_MS = 80;
const SLOW_SCAN_HINT_MS = 10_000;

interface Focus {
	index: number;
	key: string;
}

interface PendingDiscard {
	staged: ScmPick;
	unstaged: ScmPick;
	title: string;
}

function relocateFocus(next: RowBuffer, focus: Focus, previousStagedListed: number): number {
	const found = locate(next, focus.key, focus.index);
	if (found !== -1) return found;
	const total = next.paths.length;
	if (total === 0) return -1;
	const staged = keyStaged(focus.key);
	const position = staged ? focus.index : focus.index - previousStagedListed;
	const start = staged ? 0 : next.stagedListed;
	const length = staged ? next.stagedListed : total - next.stagedListed;
	if (length > 0) return start + Math.max(0, Math.min(position, length - 1));
	const other = locate(next, makeKey(!staged, keyPath(focus.key)));
	if (other !== -1) return other;
	return Math.max(0, Math.min(focus.index, total - 1));
}

function splitKeys(keys: Iterable<string>): { staged: string[]; unstaged: string[] } {
	const staged: string[] = [];
	const unstaged: string[] = [];
	for (const key of keys) (keyStaged(key) ? staged : unstaged).push(keyPath(key));
	return { staged, unstaged };
}

function pickOf(paths: string[], listedInGroup: number): ScmPick {
	return paths.length > 0 && paths.length === listedInGroup ? "all" : paths;
}

function isEmptyPick(pick: ScmPick): boolean {
	return pick !== "all" && pick.length === 0;
}

function discardTitle(staged: ScmPick, unstaged: ScmPick): string {
	if (staged === "all" && unstaged === "all") return "Discard all changes?";
	if (staged === "all" && isEmptyPick(unstaged)) return "Discard all staged changes?";
	if (unstaged === "all" && isEmptyPick(staged)) return "Discard all unstaged changes?";
	if (staged === "all" || unstaged === "all") return "Discard these changes?";
	const files = new Set([...staged, ...unstaged]).size;
	return files === 1 ? "Discard changes to 1 file?" : `Discard changes to ${files.toLocaleString("en-US")} files?`;
}

class ModalBoundary extends Component<
	{ onClose: () => void; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	render(): ReactNode {
		if (!this.state.failed) return this.props.children;
		return (
			<div className="modal-backdrop" role="presentation" onMouseDown={this.props.onClose}>
				<div className="modal-card" role="alertdialog" aria-modal="true" aria-label="Source control">
					<p className="modal-message">Source control hit an unexpected error.</p>
					<div className="modal-actions">
						<button type="button" className="btn" onClick={this.props.onClose}>
							Close
						</button>
					</div>
				</div>
			</div>
		);
	}
}

export function SourceControlModalHost() {
	const checkout = useSourceControlStore((s) => s.modalCheckout);
	const close = useSourceControlStore((s) => s.closeModal);
	if (!checkout) return null;
	return createPortal(
		<ModalBoundary onClose={close}>
			<SourceControlModal checkout={checkout} onClose={close} />
		</ModalBoundary>,
		document.body,
	);
}

function useNow(intervalMs: number, active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs, active]);
	return now;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 14 14"
			fill="none"
			aria-hidden="true"
			style={{ animation: spinning ? "asyncy-spin 0.7s linear infinite" : "none" }}
		>
			<path d="M12 7a5 5 0 1 1-1.6-3.66" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
			<path
				d="M12 2.2v2.6H9.4"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ScanStatus({ entry }: { entry: ScmEntry | undefined }) {
	const loading = entry?.loading ?? false;
	const now = useNow(loading ? 1000 : 15_000, true);
	let text = "";
	let color: string = T.textFaint;
	if (loading) {
		const elapsed = entry?.startedAt ? Math.floor((now - entry.startedAt) / 1000) : 0;
		text = elapsed >= 3 ? `Scanning… ${elapsed}s` : "Scanning…";
	} else if (entry?.error === "failed") {
		text = "Refresh failed";
		color = T.warn;
	} else if (entry?.summary) {
		text = formatAge(entry.summary.fetchedAt, now);
	}
	return (
		<span
			aria-live="polite"
			style={{ fontSize: 11.5, color, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
		>
			{text}
		</span>
	);
}

function refLabel(summary: ScmSummary | undefined): string {
	if (!summary) return "";
	if (summary.branch) return summary.branch;
	if (summary.unborn) return "No commits yet";
	return summary.head ? `detached at ${summary.head}` : "";
}

function CheckoutSwitcher({
	checkout,
	worktrees,
	onSwitch,
}: {
	checkout: string;
	worktrees: ScmWorktree[];
	onSwitch: (path: string) => void;
}) {
	const registry = useWorktreesStore((s) => s.worktrees);
	const names = useMemo(() => {
		const map = new Map<string, string>();
		for (const wt of Object.values(registry)) map.set(wt.worktreePath.replace(/\/+$/, ""), wt.displayName);
		return map;
	}, [registry]);

	const options = worktrees.some((w) => w.path === checkout)
		? worktrees
		: [{ path: checkout, branch: null, head: null, isMain: false }, ...worktrees];

	if (options.length <= 1) {
		return (
			<span style={{ fontSize: 12.5, color: T.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
				{leafName(checkout)}
			</span>
		);
	}

	const items: PickerOption[] = options.map((w) => ({
		value: w.path,
		name: names.get(w.path) ?? leafName(w.path),
		tag: w.isMain ? "main" : undefined,
		detail: w.branch ?? w.head ?? undefined,
	}));

	return <CheckoutPicker label="Checkout" value={checkout} options={items} onChange={onSwitch} />;
}

function SidebarMessage({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				padding: "18px 16px",
				fontSize: 12.5,
				color: T.textMute,
				display: "flex",
				flexDirection: "column",
				gap: 10,
				lineHeight: 1.5,
			}}
		>
			{children}
		</div>
	);
}

function failureText(entry: ScmEntry | undefined): string | null {
	switch (entry?.error) {
		case "not-a-repo":
			return "This folder isn't a git repository.";
		case "missing-cwd":
			return "This folder no longer exists.";
		case "git-missing":
			return "Git isn't installed, so changes can't be read.";
		default:
			return null;
	}
}

function SourceControlModal({ checkout, onClose }: { checkout: string; onClose: () => void }) {
	const entry = useSourceControlStore((s) => s.byCheckout[checkout]);
	const connection = useSourceControlStore((s) => s.connection);
	const viewed = useSourceControlStore((s) => s.viewed[checkout]);
	const composer = useSourceControlStore((s) => s.modalComposer);
	const comments = useSourceControlStore((s) => s.comments[checkout]);
	const commitState = useSourceControlStore((s) => s.commits[checkout]);
	const committing = (commitState?.busy ?? null) !== null;
	const reviewCount = comments?.length ?? 0;
	const commentedKeys = useMemo(() => new Set(comments?.map((c) => c.fileKey)), [comments]);
	const summary = entry?.summary;
	const loading = entry?.loading ?? false;
	const backdropProps = useBackdropDismiss(onClose);

	const cardRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<FileListHandle>(null);
	const bufferRef = useRef<RowBuffer | null>(null);
	const [, setVersion] = useState(0);
	const bump = useCallback(() => setVersion((v) => v + 1), []);
	const [focus, setFocus] = useState<Focus | null>(null);
	const focusRef = useRef(focus);
	focusRef.current = focus;
	const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const anchorRef = useRef<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
	const [commitOpen, setCommitOpen] = useState<{ all: boolean } | null>(null);
	const confirmOpenRef = useRef(false);
	confirmOpenRef.current = pendingDiscard !== null || commitOpen !== null;
	const [contentToken, setContentToken] = useState(0);
	const [forcePath, setForcePath] = useState<string | null>(null);
	const [view, setView] = useState<DiffView | null>(null);
	const scanAge = useNow(1000, loading && !summary);

	const switchCheckout = useCallback((path: string) => {
		if (path === useSourceControlStore.getState().modalCheckout) return;
		setFocus(null);
		setSelection(new Set());
		anchorRef.current = null;
		setActionError(null);
		setView(null);
		setForcePath(null);
		useSourceControlStore.setState({ modalCheckout: path });
		requestRefresh(path, true);
	}, []);

	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== "Escape" || e.isComposing || confirmOpenRef.current) return;
			const card = cardRef.current;
			if (!card) return;
			const target = e.target instanceof Node ? e.target : null;
			const insideCard = target !== null && card.contains(target);
			const onPage = target === null || target === document.body || target === document.documentElement;
			if (!insideCard && !onPage) return;
			if (card.querySelector(".find-widget.visible, .scm-picker-menu, .scm-ctx-menu")) return;
			if (target instanceof Element && target.closest(".scm-review-zone")) return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		const focusInside = (): void => {
			if (listRef.current) listRef.current.focus();
			else cardRef.current?.focus({ preventScroll: true });
		};
		const onFocusIn = (e: FocusEvent): void => {
			const root = document.getElementById("root");
			if (root && e.target instanceof Node && root.contains(e.target)) focusInside();
		};
		window.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("focusin", onFocusIn);
		const frame = requestAnimationFrame(focusInside);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("focusin", onFocusIn);
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [onClose]);

	const hasList = (summary?.listed ?? 0) > 0;
	useEffect(() => {
		if (hasList && document.activeElement === cardRef.current) listRef.current?.focus();
	}, [hasList]);

	const scanId = summary?.checkout === checkout ? summary.scanId : undefined;

	useEffect(() => {
		const current = useSourceControlStore.getState().byCheckout[checkout]?.summary;
		if (!current || current.scanId !== scanId) return;
		const existing = bufferRef.current;
		if (existing && canReuse(existing, current)) {
			existing.scanId = current.scanId;
			setContentToken((t) => t + 1);
			return;
		}

		let cancelled = false;
		let callId: number | null = null;
		const next = createBuffer(current);
		const progressive = !existing || existing.checkout !== checkout || !existing.complete;

		const previousStagedListed = existing?.stagedListed ?? 0;

		const focusRow = (index: number): void => {
			const key = rowKey(next, index);
			setFocus({ index, key });
			setSelection(new Set([key]));
			anchorRef.current = key;
		};

		const selectFirst = (): void => {
			if (focusRef.current || next.paths.length === 0) return;
			focusRow(0);
		};

		const relocate = (): void => {
			const current = focusRef.current;
			if (!current) {
				selectFirst();
				return;
			}
			const index = relocateFocus(next, current, previousStagedListed);
			if (index === -1) {
				setFocus(null);
				setSelection(new Set());
				anchorRef.current = null;
				setView(null);
				return;
			}
			const key = rowKey(next, index);
			if (key !== current.key) {
				focusRow(index);
				return;
			}
			setFocus({ index, key });
			const kept = new Set<string>();
			for (const selectedKey of selectionRef.current) {
				if (locate(next, selectedKey) !== -1) kept.add(selectedKey);
			}
			if (kept.size === 0) kept.add(key);
			setSelection(kept);
			if (anchorRef.current === null || locate(next, anchorRef.current) === -1) anchorRef.current = key;
			setContentToken((t) => t + 1);
		};

		if (progressive) {
			bufferRef.current = next;
			if (existing && existing.checkout !== checkout) {
				focusRef.current = null;
				setFocus(null);
				setSelection(new Set());
			}
			bump();
		}

		void fillRows(
			next,
			(offset, limit) => call<"rows">({ t: "rows", checkout, scanId: current.scanId, offset, limit }),
			{
				cancelled: () => cancelled,
				onCall: (id) => {
					callId = id;
				},
				onBatch: () => {
					if (!progressive) return;
					bump();
					selectFirst();
				},
			},
		).then((result) => {
			if (cancelled) return;
			if (result === "stale") {
				requestRefresh(checkout, true);
				return;
			}
			if (result !== "done") return;
			bufferRef.current = next;
			relocate();
			bump();
		});

		return () => {
			cancelled = true;
			if (callId !== null) cancel(callId);
		};
	}, [checkout, scanId, bump]);

	const focusKey = focus?.key ?? null;
	const focusIndex = focus?.index ?? -1;

	useEffect(() => {
		const buffer = bufferRef.current;
		if (!focusKey || focusIndex < 0 || !buffer || buffer.checkout !== checkout) return;
		const status = statusAt(buffer, focusIndex);
		const staged = keyStaged(focusKey);
		const path = keyPath(focusKey);
		const force = forcePath === focusKey;
		setView((prev) => ({
			path,
			status,
			staged,
			loading: true,
			content: prev?.content ?? null,
			contentPath: prev?.contentPath ?? null,
			contentStaged: prev?.contentStaged ?? false,
			noLongerChanged: false,
		}));

		let done = false;
		let callId: number | null = null;
		const timer = window.setTimeout(() => {
			const request = call<"diff">({
				t: "diff",
				checkout,
				scanId: buffer.scanId,
				index: focusIndex,
				path,
				staged,
				force,
			});
			callId = request.id;
			void request.promise.then((reply) => {
				callId = null;
				if (done) return;
				if (reply.ok) {
					setView({
						path,
						status,
						staged,
						loading: false,
						content: reply.content,
						contentPath: path,
						contentStaged: staged,
						noLongerChanged: false,
					});
					return;
				}
				if (reply.reason === "cancelled") return;
				if (reply.reason === "stale") {
					setView((v) => (v ? { ...v, loading: false } : v));
					requestRefresh(checkout, true);
					return;
				}
				setView({
					path,
					status,
					staged,
					loading: false,
					content: { kind: "error", message: "source control stopped responding." },
					contentPath: path,
					contentStaged: staged,
					noLongerChanged: false,
				});
			});
		}, DIFF_DEBOUNCE_MS);

		return () => {
			done = true;
			window.clearTimeout(timer);
			if (callId !== null) cancel(callId);
		};
	}, [checkout, focusKey, focusIndex, contentToken, forcePath]);

	const anchorIndex = (buffer: RowBuffer, fallback: number): number => {
		const anchor = anchorRef.current;
		if (anchor === null) return fallback;
		const index = locate(buffer, anchor);
		return index === -1 ? fallback : index;
	};

	const keysBetween = (buffer: RowBuffer, from: number, to: number): Set<string> => {
		const keys = new Set<string>();
		const lo = Math.max(0, Math.min(from, to));
		const hi = Math.min(buffer.paths.length - 1, Math.max(from, to));
		for (let i = lo; i <= hi; i++) keys.add(rowKey(buffer, i));
		return keys;
	};

	const onPointer = useCallback((index: number, pointer: RowPointer) => {
		const buffer = bufferRef.current;
		if (!buffer || index < 0 || index >= buffer.paths.length) return;
		const key = rowKey(buffer, index);
		if (pointer.range) {
			const range = keysBetween(buffer, anchorIndex(buffer, index), index);
			if (pointer.toggle) for (const k of selectionRef.current) range.add(k);
			setSelection(range);
		} else if (pointer.toggle) {
			const next = new Set(selectionRef.current);
			if (next.has(key) && next.size > 1) next.delete(key);
			else next.add(key);
			setSelection(next);
			anchorRef.current = key;
		} else {
			setSelection(new Set([key]));
			anchorRef.current = key;
		}
		setFocus({ index, key });
	}, []);

	const onMove = useCallback((index: number, extend: boolean) => {
		const buffer = bufferRef.current;
		if (!buffer || index < 0 || index >= buffer.paths.length) return;
		const key = rowKey(buffer, index);
		if (extend) {
			setSelection(keysBetween(buffer, anchorIndex(buffer, index), index));
		} else {
			setSelection(new Set([key]));
			anchorRef.current = key;
		}
		setFocus({ index, key });
	}, []);

	const onSelectAll = useCallback(() => {
		const buffer = bufferRef.current;
		if (!buffer || buffer.paths.length === 0) return;
		setSelection(keysBetween(buffer, 0, buffer.paths.length - 1));
	}, []);

	const send = useCallback(
		async (action: ScmAction, staged: ScmPick, unstaged: ScmPick) => {
			setBusy(true);
			setActionError(null);
			const reply = await call<"apply">({ t: "apply", checkout, action, staged, unstaged }).promise;
			setBusy(false);
			if (!reply.ok && reply.reason !== "cancelled") {
				setActionError(
					reply.message ??
						(reply.reason === "stale" ? "The list was out of date. Try again." : "Git couldn't finish that."),
				);
			}
			requestRefresh(checkout, true);
		},
		[checkout],
	);

	const perform = useCallback(
		(action: ScmAction, staged: ScmPick, unstaged: ScmPick) => {
			if (action === "stage") staged = [];
			if (action === "unstage") unstaged = [];
			if (isEmptyPick(staged) && isEmptyPick(unstaged)) return;
			if (action === "discard") {
				setPendingDiscard({ staged, unstaged, title: discardTitle(staged, unstaged) });
				return;
			}
			void send(action, staged, unstaged);
		},
		[send],
	);

	const actOnKeys = useCallback(
		(action: ScmAction, keys: Iterable<string>) => {
			const buffer = bufferRef.current;
			if (!buffer) return;
			const split = splitKeys(keys);
			perform(
				action,
				pickOf(split.staged, buffer.stagedListed),
				pickOf(split.unstaged, buffer.paths.length - buffer.stagedListed),
			);
		},
		[perform],
	);

	const onRowContext = useCallback(
		(index: number, x: number, y: number) => {
			const buffer = bufferRef.current;
			if (!buffer || index < 0 || index >= buffer.paths.length) return;
			const key = rowKey(buffer, index);
			const current = selectionRef.current;
			const keys = current.has(key) ? [...current] : [key];
			if (!current.has(key)) {
				setSelection(new Set([key]));
				anchorRef.current = key;
			}
			setFocus({ index, key });
			let staged = 0;
			for (const k of keys) if (keyStaged(k)) staged++;
			const unstaged = keys.length - staged;
			const items: MenuItem[] = [];
			if (unstaged > 0) items.push({ label: "Stage", run: () => actOnKeys("stage", keys) });
			if (staged > 0) items.push({ label: "Unstage", run: () => actOnKeys("unstage", keys) });
			items.push({ label: "Discard Changes", danger: true, run: () => actOnKeys("discard", keys) });
			setMenu({ x, y, items });
		},
		[actOnKeys],
	);

	const onGroupContext = useCallback(
		(staged: boolean, x: number, y: number) => {
			const all = (action: ScmAction) => () => perform(action, staged ? "all" : [], staged ? [] : "all");
			setMenu({
				x,
				y,
				items: [
					staged ? { label: "Unstage All", run: all("unstage") } : { label: "Stage All", run: all("stage") },
					{ label: "Discard All Changes", danger: true, run: all("discard") },
				],
			});
		},
		[perform],
	);

	const closeMenu = useCallback(() => {
		setMenu(null);
		listRef.current?.focus();
	}, []);

	const confirmDiscard = useCallback(() => {
		const pending = pendingDiscard;
		setPendingDiscard(null);
		listRef.current?.focus();
		if (pending) void send("discard", pending.staged, pending.unstaged);
	}, [pendingDiscard, send]);

	const cancelDiscard = useCallback(() => {
		setPendingDiscard(null);
		listRef.current?.focus();
	}, []);

	const openCommit = useCallback((all: boolean) => {
		if (!useSourceControlStore.getState().commits[checkout]?.busy) setCommitOpen({ all });
	}, [checkout]);

	const cancelCommit = useCallback(() => {
		setCommitOpen(null);
		listRef.current?.focus();
	}, []);

	const confirmCommit = useCallback(
		(message: string) => {
			const all = commitOpen?.all ?? false;
			setCommitOpen(null);
			onClose();
			void commitStaged(checkout, message, all).then((ok) => {
				const state = useSourceControlStore.getState();
				if (!ok && state.commits[checkout]?.error && state.modalCheckout === null) {
					state.openModal(checkout, composer ?? undefined);
				}
			});
		},
		[checkout, commitOpen, composer, onClose],
	);

	const onViewed = useCallback(
		(index: number) => {
			const buffer = bufferRef.current;
			if (!buffer || index < 0 || index >= buffer.paths.length) return;
			useSourceControlStore.getState().toggleViewed(checkout, rowKey(buffer, index));
		},
		[checkout],
	);

	const sendReview = useCallback(() => {
		const state = useSourceControlStore.getState();
		const comments = state.comments[checkout];
		if (!composer || !comments?.length) return;
		appendPromptBlock(composer, buildReviewPrompt(comments));
		state.clearComments(checkout);
		onClose();
		focusComposer();
	}, [checkout, composer, onClose]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.isComposing || confirmOpenRef.current) return;
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest(".scm-review-zone")) return;
			const typing = target?.matches("input, textarea, [contenteditable='true']") && !target.closest(".monaco-editor");
			if (typing) return;
			const state = useSourceControlStore.getState();
			if (!composer || !state.comments[checkout]?.length) return;
			e.preventDefault();
			e.stopPropagation();
			sendReview();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [checkout, composer, sendReview]);

	const onForce = useCallback(() => {
		const key = focusRef.current?.key;
		if (key) setForcePath(key);
	}, []);

	const buffer = bufferRef.current && bufferRef.current.checkout === checkout ? bufferRef.current : null;
	const rows: FileListRows = {
		count: buffer?.paths.length ?? 0,
		stagedCount: buffer?.stagedListed ?? 0,
		stagedTotal: summary?.staged ?? 0,
		unstagedTotal: summary?.unstaged ?? 0,
		path: (i) => buffer?.paths[i] ?? "",
		status: (i) => (buffer ? statusAt(buffer, i) : "M"),
		selected: (i) => (buffer ? selection.has(rowKey(buffer, i)) : false),
		viewed: (i) => (buffer && viewed ? viewed.has(rowKey(buffer, i)) : false),
		commented: (i) => (buffer ? commentedKeys.has(rowKey(buffer, i)) : false),
	};
	const selectedCount = selection.size;

	const failure = failureText(entry);
	const listed = summary?.listed ?? 0;
	const rowTotal = (summary?.staged ?? 0) + (summary?.unstaged ?? 0);
	const conflicts = summary?.conflicts ?? 0;
	const showSlowHint = loading && !summary && entry?.startedAt !== undefined && scanAge - entry.startedAt > SLOW_SCAN_HINT_MS;

	let sidebarBody: ReactNode;
	if (summary && listed > 0) {
		sidebarBody = (
			<FileList
				ref={listRef}
				rows={rows}
				focused={focusIndex}
				label="Changed files"
				onPointer={onPointer}
				onMove={onMove}
				onSelectAll={onSelectAll}
				onRowContext={onRowContext}
				onGroupContext={onGroupContext}
				onViewed={onViewed}
				onCommit={openCommit}
				committing={committing}
			/>
		);
	} else if (summary) {
		sidebarBody = <SidebarMessage>No changes in this checkout.</SidebarMessage>;
	} else if (failure && isHardFailure(entry?.error)) {
		sidebarBody = <SidebarMessage>{failure}</SidebarMessage>;
	} else if (connection === "down") {
		sidebarBody = (
			<SidebarMessage>
				<span>Source control stopped responding.</span>
				<button
					type="button"
					className="btn"
					style={{ alignSelf: "flex-start" }}
					onClick={() => {
						retryConnection();
						requestRefresh(checkout, true);
					}}
				>
					Retry
				</button>
			</SidebarMessage>
		);
	} else if (entry?.error === "failed" && !loading) {
		sidebarBody = (
			<SidebarMessage>
				<span>Couldn't read this checkout's changes.</span>
				<button
					type="button"
					className="btn"
					style={{ alignSelf: "flex-start" }}
					onClick={() => requestRefresh(checkout, true)}
				>
					Try again
				</button>
			</SidebarMessage>
		);
	} else {
		sidebarBody = (
			<SidebarMessage>
				<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
					<span className="asyncy-btn-spinner" aria-hidden="true" />
					Scanning for changes…
				</span>
				{showSlowHint ? (
					<span style={{ color: T.textFaint, fontSize: 12 }}>
						Large repositories can take a while. Turning on git's file system monitor speeds this up a lot:{" "}
						<code style={{ fontFamily: T.mono, fontSize: 11.5, color: T.textDim }}>git config core.fsmonitor true</code>
					</span>
				) : null}
			</SidebarMessage>
		);
	}

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				ref={cardRef}
				className="modal-card scm-modal"
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label="Source control"
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						height: 50,
						padding: "0 10px 0 16px",
						borderBottom: `0.5px solid ${T.borderSoft}`,
						flexShrink: 0,
					}}
				>
					<span style={{ fontSize: 14, fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>
						Source Control
					</span>
					<CheckoutSwitcher checkout={checkout} worktrees={summary?.worktrees ?? []} onSwitch={switchCheckout} />
					<span
						style={{
							fontFamily: T.mono,
							fontSize: 11.5,
							color: T.textMute,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							minWidth: 0,
						}}
					>
						{refLabel(summary)}
					</span>
					<span style={{ flex: 1 }} />
					<ScanStatus entry={entry} />
					{composer && reviewCount > 0 ? (
						<button type="button" className="btn btn-primary scm-review-send" onClick={sendReview}>
							Send review
							<span className="scm-review-count">{reviewCount}</span>
						</button>
					) : null}
					<button
						type="button"
						className="btn btn-ghost btn-icon"
						aria-label="Refresh"
						aria-busy={loading || undefined}
						onClick={() => requestRefresh(checkout, true)}
					>
						<RefreshIcon spinning={loading} />
					</button>
					<button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
						<CloseIcon />
					</button>
				</div>
				<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
					<div
						style={{
							width: "clamp(260px, 26vw, 440px)",
							flexShrink: 0,
							display: "flex",
							flexDirection: "column",
							borderRight: `0.5px solid ${T.borderSoft}`,
							background: T.surfaceLow,
						}}
					>
						{selectedCount > 1 || conflicts > 0 || busy ? (
							<div
								style={{
									flexShrink: 0,
									display: "flex",
									alignItems: "center",
									gap: 8,
									height: 36,
									padding: "0 14px",
									borderBottom: `0.5px solid ${T.borderSoft}`,
									fontSize: 12,
									color: T.textDim,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{selectedCount > 1 ? <span>{selectedCount.toLocaleString("en-US")} selected</span> : null}
								{conflicts > 0 ? (
									<span style={{ color: T.danger }}>{plural(conflicts, "conflict", "conflicts")}</span>
								) : null}
								<span style={{ flex: 1 }} />
								{busy ? <span className="asyncy-btn-spinner" aria-label="Working" /> : null}
							</div>
						) : null}
						{commitState?.error ? (
							<div
								role="alert"
								style={{
									flexShrink: 0,
									display: "flex",
									alignItems: "flex-start",
									gap: 8,
									padding: "8px 10px 8px 14px",
									borderBottom: `0.5px solid ${T.borderSoft}`,
									fontSize: 12,
									color: T.danger,
									background: T.dangerSoft,
								}}
							>
								<span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
									{commitState.error}
								</span>
								<button
									type="button"
									className="scm-row-action"
									aria-label="Dismiss error"
									onClick={() => useSourceControlStore.getState().dismissCommitError(checkout)}
								>
									<CloseIcon />
								</button>
							</div>
						) : null}
						{actionError ? (
							<div
								role="alert"
								style={{
									flexShrink: 0,
									display: "flex",
									alignItems: "flex-start",
									gap: 8,
									padding: "8px 10px 8px 14px",
									borderBottom: `0.5px solid ${T.borderSoft}`,
									fontSize: 12,
									color: T.danger,
									background: T.dangerSoft,
								}}
							>
								<span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{actionError}</span>
								<button
									type="button"
									className="scm-row-action"
									aria-label="Dismiss error"
									onClick={() => setActionError(null)}
								>
									<CloseIcon />
								</button>
							</div>
						) : null}
						<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
							{sidebarBody}
						</div>
						{summary && rowTotal > listed ? (
							<div
								style={{
									flexShrink: 0,
									padding: "8px 14px",
									borderTop: `0.5px solid ${T.borderSoft}`,
									fontSize: 11.5,
									color: T.textFaint,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								Showing the first {listed.toLocaleString("en-US")} of {rowTotal.toLocaleString("en-US")}
							</div>
						) : null}
					</div>
					<DiffPane view={summary && listed > 0 ? view : null} onForce={onForce} reviewCheckout={composer ? checkout : null} />
				</div>
				{menu ? <ScmContextMenu x={menu.x} y={menu.y} items={menu.items} disabled={busy} onClose={closeMenu} /> : null}
			</div>
			{commitOpen ? (
				<CommitModal all={commitOpen.all} count={commitOpen.all ? (summary?.changed ?? 0) : (summary?.staged ?? 0)} onConfirm={confirmCommit} onCancel={cancelCommit} />
			) : null}
			<ConfirmModal
				open={pendingDiscard !== null}
				title={pendingDiscard?.title ?? ""}
				message="This can't be undone."
				confirmLabel="Discard"
				destructive
				onConfirm={confirmDiscard}
				onCancel={cancelDiscard}
			/>
		</div>
	);
}
