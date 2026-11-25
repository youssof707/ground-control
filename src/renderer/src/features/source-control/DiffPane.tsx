import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ScmDiffContent, ScmFileStatus } from "@shared/schemas/source_control";
import { T } from "../../design/tokens";
import { CopyButton } from "./CopyButton";
import { STATUS_LABEL } from "./FileRow";
import { formatBytes } from "./format";
import { isHeavy, onlyLineEndingsDiffer } from "./diffText";
import { indentFactor, widenIndent } from "./monaco/indent";
import { loadMonaco, type MonacoModule } from "./monaco/load";
import { ReviewBox } from "./ReviewBox";
import { snippet } from "./reviewPrompt";
import { makeKey } from "./rowBuffer";
import { useSourceControlStore, type ReviewComment } from "./useSourceControlStore";

type EditorNs = typeof import("monaco-editor/editor/editor.api").editor;
type DiffEditor = import("monaco-editor/editor/editor.api").editor.IStandaloneDiffEditor;
type ViewZone = import("monaco-editor/editor/editor.api").editor.IViewZone;
type MouseTarget = import("monaco-editor/editor/editor.api").editor.IMouseTarget;
type CodeEditor = import("monaco-editor/editor/editor.api").editor.ICodeEditor;

interface Zone {
	id: string;
	zoneId: string;
	startLine: number;
	zone: ViewZone;
	node: HTMLDivElement;
	margin: HTMLDivElement;
}

function paintZones(editor: DiffEditor, zones: Iterable<Zone>): void {
	const changes = editor.getLineChanges() ?? [];
	for (const z of zones) {
		const line = z.zone.afterLineNumber;
		const inserted = changes.some(
			(c) => c.modifiedEndLineNumber > 0 && line >= c.modifiedStartLineNumber && line <= c.modifiedEndLineNumber,
		);
		z.node.classList.toggle("is-inserted", inserted);
		z.margin.classList.toggle("is-inserted", inserted);
	}
}

function indentColumns(text: string, tabSize: number): number {
	let columns = 0;
	for (const ch of text) {
		if (ch === "\t") columns += tabSize - (columns % tabSize);
		else if (ch === " ") columns += 1;
		else break;
	}
	return columns;
}

function alignZones(editor: CodeEditor, fontInfo: EditorNs["EditorOption"]["fontInfo"], zones: Iterable<Zone>): void {
	const model = editor.getModel();
	if (!model) return;
	const spaceWidth = editor.getOption(fontInfo).spaceWidth;
	const tabSize = model.getOptions().tabSize;
	const lineCount = model.getLineCount();
	for (const z of zones) {
		let columns = Number.POSITIVE_INFINITY;
		const last = Math.min(z.zone.afterLineNumber, lineCount);
		for (let line = Math.min(z.startLine, last); line <= last; line++) {
			if (model.getLineFirstNonWhitespaceColumn(line) === 0) continue;
			columns = Math.min(columns, indentColumns(model.getLineContent(line), tabSize));
		}
		z.node.style.paddingLeft = `${Number.isFinite(columns) ? columns * spaceWidth : 0}px`;
	}
}

interface Draft {
	startLine: number;
	endLine: number;
}

const NO_COMMENTS: ReviewComment[] = [];
const ISOLATED_EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "contextmenu"];

function draftId(draft: Draft): string {
	return `draft:${draft.startLine}-${draft.endLine}`;
}

function commentLine(types: EditorNs["MouseTargetType"], target: MouseTarget): number | null {
	if (!target.position) return null;
	switch (target.type) {
		case types.GUTTER_GLYPH_MARGIN:
		case types.GUTTER_LINE_NUMBERS:
		case types.GUTTER_LINE_DECORATIONS:
		case types.CONTENT_TEXT:
		case types.CONTENT_EMPTY:
			return target.position.lineNumber;
		default:
			return null;
	}
}

export interface DiffView {
	path: string;
	status: ScmFileStatus;
	staged: boolean;
	loading: boolean;
	content: ScmDiffContent | null;
	contentPath: string | null;
	contentStaged: boolean;
	noLongerChanged: boolean;
}

const SLOW_LOADING_MS = 150;

interface Shown {
	path: string;
	staged: boolean;
	original: string;
	modified: string;
}

function Notice({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 12,
				padding: 24,
				textAlign: "center",
				fontSize: 13,
				color: T.textMute,
				background: T.win,
			}}
		>
			{children}
		</div>
	);
}

function Banner({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
	return (
		<div
			style={{
				flexShrink: 0,
				padding: "6px 14px",
				fontSize: 12,
				color: tone === "warn" ? T.warn : T.textDim,
				background: tone === "warn" ? T.warnSoft : T.surfaceLow,
				borderBottom: `0.5px solid ${T.borderSoft}`,
			}}
		>
			{children}
		</div>
	);
}

function describe(content: ScmDiffContent, onForce: () => void): ReactNode {
	switch (content.kind) {
		case "text":
			return null;
		case "binary":
			return <span>Binary file. Its contents are not shown.</span>;
		case "too-large":
			return (
				<>
					<span>
						{content.bytes >= 0
							? `This file is ${formatBytes(content.bytes)}, too large to show automatically.`
							: "This file is too large to show automatically."}
					</span>
					{content.canForce ? (
						<button type="button" className="btn" onClick={onForce}>
							Load anyway
						</button>
					) : (
						<span style={{ color: T.textFaint, fontSize: 12 }}>
							Files over 8 MB are never loaded here.
						</span>
					)}
				</>
			);
		case "submodule":
			return <span>Submodule. Open it as its own repository to see its changes.</span>;
		case "directory":
			return <span>Untracked folder that is its own git repository. Its files are not listed here.</span>;
		case "gone":
			return <span>This file no longer exists on disk.</span>;
		case "error":
			return <span>Couldn't read this file: {content.message}</span>;
	}
}

export function DiffPane({
	view,
	onForce,
	reviewCheckout,
}: {
	view: DiffView | null;
	onForce: () => void;
	reviewCheckout: string | null;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<DiffEditor | null>(null);
	const monacoRef = useRef<MonacoModule | null>(null);
	const shownRef = useRef<Shown | null>(null);
	const [ready, setReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [workerFailed, setWorkerFailed] = useState(false);
	const [slow, setSlow] = useState(false);
	const [modelVersion, setModelVersion] = useState(0);
	const [shownKey, setShownKey] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const zonesRef = useRef(new Map<string, Zone>());
	const [zones, setZones] = useState<Zone[]>([]);
	const commentableRef = useRef(false);
	const shownKeyRef = useRef<string | null>(null);
	const draftTextRef = useRef("");

	useEffect(() => {
		let disposed = false;
		let unsubscribe: (() => void) | null = null;
		loadMonaco()
			.then((mod) => {
				if (disposed || !hostRef.current) return;
				monacoRef.current = mod;
				if (mod.editorWorkerFailed()) setWorkerFailed(true);
				unsubscribe = mod.onEditorWorkerFailure(() => setWorkerFailed(true));
				editorRef.current = mod.monaco.editor.createDiffEditor(hostRef.current, {
					theme: mod.THEME_NAME,
					readOnly: true,
					domReadOnly: true,
					originalEditable: false,
					automaticLayout: true,
					renderSideBySide: false,
					renderIndicators: false,
					hideUnchangedRegions: {
						enabled: true,
						contextLineCount: 3,
						minimumLineCount: 6,
						revealLineCount: 20,
					},
					maxComputationTime: 3000,
					maxFileSize: 20,
					ignoreTrimWhitespace: false,
					renderMarginRevertIcon: false,
					renderGutterMenu: false,
					renderOverviewRuler: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					stickyScroll: { enabled: false },
					folding: false,
					glyphMargin: true,
					links: false,
					occurrencesHighlight: "off",
					selectionHighlight: false,
					renderValidationDecorations: "off",
					renderLineHighlight: "none",
					wordWrap: "off",
					diffWordWrap: "off",
					fontFamily: T.mono,
					fontSize: 12.5,
					lineHeight: 19,
					padding: { top: 6 },
					scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
				});
				void document.fonts?.ready.then(() => {
					if (!disposed) mod.monaco.editor.remeasureFonts();
				});
				setReady(true);
			})
			.catch((err: unknown) => {
				if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			disposed = true;
			unsubscribe?.();
			const editor = editorRef.current;
			editorRef.current = null;
			if (editor) {
				const model = editor.getModel();
				editor.dispose();
				model?.original.dispose();
				model?.modified.dispose();
			}
			shownRef.current = null;
		};
	}, []);

	const loading = view?.loading ?? false;
	useEffect(() => {
		if (!loading) {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_LOADING_MS);
		return () => window.clearTimeout(timer);
	}, [loading]);

	const content = view?.content ?? null;
	const contentPath = view?.contentPath ?? null;
	const contentStaged = view?.contentStaged ?? false;

	useEffect(() => {
		const mod = monacoRef.current;
		const editor = editorRef.current;
		if (!ready || workerFailed || !mod || !editor) return;
		if (!content || content.kind !== "text" || !contentPath) return;
		const prev = shownRef.current;
		if (
			prev &&
			prev.path === contentPath &&
			prev.staged === contentStaged &&
			prev.original === content.original &&
			prev.modified === content.modified
		) {
			return;
		}
		const sameFile = prev?.path === contentPath;
		const viewState = sameFile ? editor.saveViewState() : null;
		const heavy = isHeavy(content.original) || isHeavy(content.modified);
		const language = heavy ? "plaintext" : mod.languageFor(contentPath);
		const factor = indentFactor(content.modified || content.original);
		const original = mod.monaco.editor.createModel(widenIndent(content.original, factor), language);
		const modified = mod.monaco.editor.createModel(widenIndent(content.modified, factor), language);
		original.updateOptions({ tabSize: 4, indentSize: 4 });
		modified.updateOptions({ tabSize: 4, indentSize: 4 });
		const old = editor.getModel();
		const zones = zonesRef.current;
		editor.getModifiedEditor().changeViewZones((acc) => {
			for (const z of zones.values()) acc.removeZone(z.zoneId);
		});
		zones.clear();
		editor.setModel({ original, modified });
		if (viewState) editor.restoreViewState(viewState);
		old?.original.dispose();
		old?.modified.dispose();
		shownRef.current = { path: contentPath, staged: contentStaged, original: content.original, modified: content.modified };
		const key = makeKey(contentStaged, contentPath);
		if (shownKeyRef.current !== key) {
			setDraft(null);
			draftTextRef.current = "";
		}
		shownKeyRef.current = key;
		setShownKey(key);
		setZones([]);
		setModelVersion((v) => v + 1);
	}, [ready, workerFailed, content, contentPath, contentStaged]);

	const allComments = useSourceControlStore((s) => (reviewCheckout ? s.comments[reviewCheckout] : undefined));
	const fileComments = useMemo(
		() => (allComments && shownKey ? allComments.filter((c) => c.fileKey === shownKey) : NO_COMMENTS),
		[allComments, shownKey],
	);
	const commentable = reviewCheckout !== null && shownKey !== null && content?.kind === "text";
	commentableRef.current = commentable;

	useEffect(() => {
		const mod = monacoRef.current;
		const editor = editorRef.current;
		if (!ready || !mod || !editor) return;
		const modified = editor.getModifiedEditor();
		const types = mod.monaco.editor.MouseTargetType;
		let hover: string[] = [];
		let hoverLine: number | null = null;
		const setHover = (line: number | null): void => {
			if (line === hoverLine) return;
			hoverLine = line;
			hover = modified.deltaDecorations(
				hover,
				line === null
					? []
					: [{ range: new mod.monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "scm-comment-glyph" } }],
			);
		};
		const move = modified.onMouseMove((e) => setHover(commentableRef.current ? commentLine(types, e.target) : null));
		const leave = modified.onMouseLeave(() => setHover(null));
		const diffed = editor.onDidUpdateDiff(() => paintZones(editor, zonesRef.current.values()));
		const fontInfo = mod.monaco.editor.EditorOption.fontInfo;
		const remeasured = modified.onDidChangeConfiguration((e) => {
			if (e.hasChanged(fontInfo)) alignZones(modified, fontInfo, zonesRef.current.values());
		});
		const swap = modified.onDidChangeModel(() => {
			hover = [];
			hoverLine = null;
		});
		const down = modified.onMouseDown((e) => {
			if (!commentableRef.current || e.target.type !== types.GUTTER_GLYPH_MARGIN) return;
			const line = commentLine(types, e.target);
			if (line === null) return;
			const sel = modified.getSelection();
			let startLine = line;
			let endLine = line;
			if (sel && !sel.isEmpty() && line >= sel.startLineNumber && line <= sel.endLineNumber) {
				startLine = sel.startLineNumber;
				endLine = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
			}
			draftTextRef.current = "";
			setDraft({ startLine, endLine });
		});
		return () => {
			move.dispose();
			leave.dispose();
			diffed.dispose();
			remeasured.dispose();
			swap.dispose();
			down.dispose();
			modified.deltaDecorations(hover, []);
		};
	}, [ready]);

	useEffect(() => {
		const mod = monacoRef.current;
		const editor = editorRef.current;
		if (!ready || !mod || !editor) return;
		const modified = editor.getModifiedEditor();
		const lineCount = modified.getModel()?.getLineCount() ?? 0;
		const wanted = new Map<string, Draft>();
		if (commentable && lineCount > 0) {
			for (const c of fileComments) wanted.set(c.id, { startLine: c.startLine, endLine: Math.min(c.endLine, lineCount) });
			if (draft) wanted.set(draftId(draft), { startLine: draft.startLine, endLine: Math.min(draft.endLine, lineCount) });
		}
		const current = zonesRef.current;
		let changed = false;
		modified.changeViewZones((acc) => {
			for (const [id, z] of current) {
				if (wanted.has(id)) continue;
				acc.removeZone(z.zoneId);
				current.delete(id);
				changed = true;
			}
			for (const [id, { startLine, endLine }] of wanted) {
				if (current.has(id)) continue;
				const node = document.createElement("div");
				node.className = "scm-review-zone";
				for (const type of ISOLATED_EVENTS) node.addEventListener(type, (e) => e.stopPropagation());
				const margin = document.createElement("div");
				margin.className = "scm-review-margin";
				const zone: ViewZone = { afterLineNumber: endLine, heightInPx: 0, domNode: node, marginDomNode: margin };
				current.set(id, { id, zoneId: acc.addZone(zone), startLine, zone, node, margin });
				changed = true;
			}
		});
		paintZones(editor, current.values());
		alignZones(modified, mod.monaco.editor.EditorOption.fontInfo, current.values());
		if (changed) setZones([...current.values()]);
	}, [ready, modelVersion, commentable, fileComments, draft]);

	const layoutZone = useCallback((id: string, height: number) => {
		const z = zonesRef.current.get(id);
		const editor = editorRef.current;
		if (!z || !editor || z.zone.heightInPx === height) return;
		z.zone.heightInPx = height;
		editor.getModifiedEditor().changeViewZones((acc) => acc.layoutZone(z.zoneId));
	}, []);

	const heightFor = useMemo(() => {
		const map = new Map<string, (h: number) => void>();
		return (id: string) => {
			let fn = map.get(id);
			if (!fn) {
				fn = (h: number) => layoutZone(id, h);
				map.set(id, fn);
			}
			return fn;
		};
	}, [layoutZone]);

	const saveDraft = useCallback(
		(body: string) => {
			const model = editorRef.current?.getModifiedEditor().getModel();
			if (!draft || !reviewCheckout || !shownKey || !model || !contentPath) return;
			const last = Math.min(draft.endLine, model.getLineCount());
			const lines: string[] = [];
			for (let i = draft.startLine; i <= last; i++) lines.push(model.getLineContent(i));
			useSourceControlStore.getState().addComment(reviewCheckout, {
				fileKey: shownKey,
				path: contentPath,
				startLine: draft.startLine,
				endLine: draft.endLine,
				code: snippet(lines),
				body,
			});
			setDraft(null);
			draftTextRef.current = "";
		},
		[draft, reviewCheckout, shownKey, contentPath],
	);

	const cancelDraft = useCallback(() => setDraft(null), []);
	const setDraftText = useCallback((text: string) => {
		draftTextRef.current = text;
	}, []);

	const commentsById = useMemo(() => new Map(fileComments.map((c) => [c.id, c])), [fileComments]);
	const portals = zones.map((z) => {
		if (z.id.startsWith("draft:")) {
			if (!draft || z.id !== draftId(draft)) return null;
			return createPortal(
				<ReviewBox
					startLine={draft.startLine}
					endLine={draft.endLine}
					body={null}
					initialText={draftTextRef.current}
					onTextChange={setDraftText}
					onSave={saveDraft}
					onCancel={cancelDraft}
					onHeight={heightFor(z.id)}
				/>,
				z.node,
				z.id,
			);
		}
		const c = commentsById.get(z.id);
		if (!c || !reviewCheckout) return null;
		const store = useSourceControlStore.getState();
		return createPortal(
			<ReviewBox
				startLine={c.startLine}
				endLine={c.endLine}
				body={c.body}
				onSave={(body) => store.editComment(reviewCheckout, c.id, body)}
				onCancel={cancelDraft}
				onDelete={() => store.removeComment(reviewCheckout, c.id)}
				onHeight={heightFor(z.id)}
			/>,
			z.node,
			z.id,
		);
	});

	const showingText = content?.kind === "text";
	const notice = content && content.kind !== "text" ? describe(content, onForce) : null;
	const eolOnly = useMemo(
		() => content?.kind === "text" && onlyLineEndingsDiffer(content.original, content.modified),
		[content],
	);
	const empty = content?.kind === "text" && content.original === "" && content.modified === "";

	return (
		<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: T.win }}>
			<div
				style={{
					flexShrink: 0,
					display: "flex",
					alignItems: "center",
					gap: 10,
					height: 36,
					padding: "0 14px",
					borderBottom: `0.5px solid ${T.borderSoft}`,
				}}
			>
				{view ? (
					<>
						<span
							style={{
								flex: "0 1 auto",
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								direction: "rtl",
								textAlign: "left",
								fontFamily: T.mono,
								fontSize: 12,
								color: T.text,
							}}
						>
							<bdi>{view.path}</bdi>
						</span>
						<CopyButton text={view.path} label={`Copy path ${view.path}`} iconOnly />
						<span style={{ flex: 1 }} />
						{loading && slow ? <span className="asyncy-btn-spinner" aria-label="Loading diff" /> : null}
						<span style={{ fontSize: 11.5, color: T.textMute, flexShrink: 0 }}>
							{view.staged ? `${STATUS_LABEL[view.status]} · Staged` : STATUS_LABEL[view.status]}
						</span>
					</>
				) : (
					<span style={{ fontSize: 12, color: T.textFaint }}>No file selected</span>
				)}
			</div>
			{view?.noLongerChanged ? (
				<Banner tone="info">This file no longer has changes. Showing the last version loaded.</Banner>
			) : null}
			{content?.kind === "text" && content.lossy ? (
				<Banner tone="warn">This file isn't valid UTF-8. Unreadable bytes are shown as �.</Banner>
			) : null}
			{eolOnly ? <Banner tone="info">Only line endings changed.</Banner> : null}
			<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
				<div
					ref={hostRef}
					aria-label={view ? `Diff of ${view.path}` : "Diff"}
					style={{
						position: "absolute",
						inset: 0,
						visibility: showingText && !empty ? "visible" : "hidden",
						opacity: loading && slow ? 0.55 : 1,
						transition: "opacity 120ms ease",
					}}
				/>
				{loadError ? (
					<Notice>
						<span>The diff viewer failed to load.</span>
						<span style={{ color: T.textFaint, fontSize: 12 }}>{loadError}</span>
					</Notice>
				) : workerFailed ? (
					<Notice>
						<span>The diff engine failed to start, so diffs are disabled to keep the app responsive.</span>
					</Notice>
				) : !view ? (
					<Notice>
						<span>Select a file to see its changes.</span>
					</Notice>
				) : !content || !ready ? (
					slow || !ready ? (
						<Notice>
							<span className="asyncy-btn-spinner" aria-label="Loading" />
						</Notice>
					) : null
				) : notice ? (
					<Notice>{notice}</Notice>
				) : empty ? (
					<Notice>
						<span>Empty file.</span>
					</Notice>
				) : null}
				{portals}
			</div>
		</div>
	);
}
