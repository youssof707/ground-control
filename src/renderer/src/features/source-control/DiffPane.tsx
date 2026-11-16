import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScmDiffContent, ScmFileStatus } from "@shared/schemas/source_control";
import { T } from "../../design/tokens";
import { STATUS_LABEL } from "./FileRow";
import { formatBytes } from "./format";
import { isHeavy, onlyLineEndingsDiffer } from "./diffText";
import { loadMonaco, type MonacoModule } from "./monaco/load";

type DiffEditor = import("monaco-editor/editor/editor.api").editor.IStandaloneDiffEditor;

export interface DiffView {
	path: string;
	status: ScmFileStatus;
	staged: boolean;
	loading: boolean;
	content: ScmDiffContent | null;
	contentPath: string | null;
	noLongerChanged: boolean;
}

const SLOW_LOADING_MS = 150;

interface Shown {
	path: string;
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
}: {
	view: DiffView | null;
	onForce: () => void;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<DiffEditor | null>(null);
	const monacoRef = useRef<MonacoModule | null>(null);
	const shownRef = useRef<Shown | null>(null);
	const [ready, setReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [workerFailed, setWorkerFailed] = useState(false);
	const [slow, setSlow] = useState(false);

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
					renderIndicators: true,
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
					glyphMargin: false,
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

	useEffect(() => {
		const mod = monacoRef.current;
		const editor = editorRef.current;
		if (!ready || workerFailed || !mod || !editor) return;
		if (!content || content.kind !== "text" || !contentPath) return;
		const prev = shownRef.current;
		if (
			prev &&
			prev.path === contentPath &&
			prev.original === content.original &&
			prev.modified === content.modified
		) {
			return;
		}
		const sameFile = prev?.path === contentPath;
		const viewState = sameFile ? editor.saveViewState() : null;
		const heavy = isHeavy(content.original) || isHeavy(content.modified);
		const language = heavy ? "plaintext" : mod.languageFor(contentPath);
		const original = mod.monaco.editor.createModel(content.original, language);
		const modified = mod.monaco.editor.createModel(content.modified, language);
		original.updateOptions({ tabSize: 4, indentSize: 4 });
		modified.updateOptions({ tabSize: 4, indentSize: 4 });
		const old = editor.getModel();
		editor.setModel({ original, modified });
		if (viewState) editor.restoreViewState(viewState);
		old?.original.dispose();
		old?.modified.dispose();
		shownRef.current = { path: contentPath, original: content.original, modified: content.modified };
	}, [ready, workerFailed, content, contentPath]);

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
								flex: 1,
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
			</div>
		</div>
	);
}
