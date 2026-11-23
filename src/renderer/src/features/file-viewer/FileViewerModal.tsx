import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "../../components/useBackdropDismiss";
import { T } from "../../design/tokens";
import { CopyButton } from "../source-control/CopyButton";
import { isHeavy } from "../source-control/diffText";
import { indentFactor, widenIndent } from "../source-control/monaco/indent";
import { loadMonaco } from "../source-control/monaco/load";
import { formatFileRef } from "./fileRef";
import { useFileViewerStore, type OpenFile } from "./useFileViewerStore";

type CodeEditor = import("monaco-editor/editor/editor.api").editor.IStandaloneCodeEditor;

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

function noticeFor(file: OpenFile): ReactNode {
	switch (file.result.kind) {
		case "gone":
			return <span>This file doesn't exist.</span>;
		case "error":
			return <span>Couldn't read this file: {file.result.message}</span>;
		default:
			return null;
	}
}

function lineLabel(file: OpenFile): string | null {
	const { line, endLine } = file.ref;
	if (line === undefined) return null;
	return endLine !== undefined && endLine !== line ? `Lines ${line}–${endLine}` : `Line ${line}`;
}

function FileViewerModal({ file, onClose }: { file: OpenFile; onClose: () => void }) {
	const cardRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<CodeEditor | null>(null);
	const [ready, setReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const backdropProps = useBackdropDismiss(onClose);
	const result = file.result;
	const text = result.kind === "text" ? result.text : null;

	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== "Escape" || e.isComposing) return;
			if (cardRef.current?.querySelector(".find-widget.visible")) return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		const frame = requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", onKeyDown, true);
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [onClose]);

	useEffect(() => {
		if (text === null) return;
		let disposed = false;
		loadMonaco()
			.then((mod) => {
				if (disposed || !hostRef.current) return;
				const language = isHeavy(text) ? "plaintext" : mod.languageFor(result.path);
				const model = mod.monaco.editor.createModel(widenIndent(text, indentFactor(text)), language);
				model.updateOptions({ tabSize: 4, indentSize: 4 });
				const editor = mod.monaco.editor.create(hostRef.current, {
					model,
					theme: mod.THEME_NAME,
					readOnly: true,
					domReadOnly: true,
					automaticLayout: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					stickyScroll: { enabled: false },
					folding: false,
					links: false,
					occurrencesHighlight: "off",
					renderValidationDecorations: "off",
					renderLineHighlight: "none",
					wordWrap: "off",
					fontFamily: T.mono,
					fontSize: 12.5,
					lineHeight: 19,
					padding: { top: 6 },
					scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
				});
				editorRef.current = editor;
				const { line, endLine } = file.ref;
				const count = model.getLineCount();
				if (line !== undefined) {
					const start = Math.min(line, count);
					const end = Math.min(Math.max(endLine ?? start, start), count);
					editor.createDecorationsCollection([
						{
							range: new mod.monaco.Range(start, 1, end, 1),
							options: { isWholeLine: true, className: "fv-line-highlight", linesDecorationsClassName: "fv-line-gutter" },
						},
					]);
					editor.revealLinesInCenter(start, end);
					editor.setPosition({ lineNumber: start, column: 1 });
				}
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
			const editor = editorRef.current;
			editorRef.current = null;
			if (editor) {
				const model = editor.getModel();
				editor.dispose();
				model?.dispose();
			}
			setReady(false);
		};
	}, [text, result.path, file.ref]);

	const notice = noticeFor(file);
	const lines = lineLabel(file);

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				ref={cardRef}
				className="modal-card scm-modal"
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={`File ${result.path}`}
			>
				<div
					style={{
						flexShrink: 0,
						display: "flex",
						alignItems: "center",
						gap: 10,
						height: 44,
						padding: "0 10px 0 16px",
						borderBottom: `0.5px solid ${T.borderSoft}`,
					}}
				>
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
						<bdi>{result.path}</bdi>
					</span>
					<CopyButton text={result.path} label={`Copy path ${result.path}`} iconOnly />
					<span style={{ flex: 1 }} />
					{lines ? <span style={{ fontSize: 11.5, color: T.textMute, flexShrink: 0 }}>{lines}</span> : null}
					{result.kind !== "gone" ? (
						<button type="button" className="btn btn-ghost" onClick={() => void window.claude.revealPath(result.path)}>
							Reveal in Finder
						</button>
					) : null}
					<button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close file viewer">
						Close
					</button>
				</div>
				{result.kind === "text" && result.lossy ? (
					<div
						style={{
							flexShrink: 0,
							padding: "6px 14px",
							fontSize: 12,
							color: T.warn,
							background: T.warnSoft,
							borderBottom: `0.5px solid ${T.borderSoft}`,
						}}
					>
						This file isn't valid UTF-8. Unreadable bytes are shown as �.
					</div>
				) : null}
				<div style={{ flex: 1, minHeight: 0, position: "relative", background: T.win }}>
					<div
						ref={hostRef}
						aria-label={`Contents of ${formatFileRef({ ...file.ref, path: result.path })}`}
						style={{ position: "absolute", inset: 0, visibility: ready && text !== "" ? "visible" : "hidden" }}
					/>
					{notice ? (
						<Notice>{notice}</Notice>
					) : loadError ? (
						<Notice>
							<span>The file viewer failed to load.</span>
							<span style={{ color: T.textFaint, fontSize: 12 }}>{loadError}</span>
						</Notice>
					) : text === "" ? (
						<Notice>
							<span>Empty file.</span>
						</Notice>
					) : !ready ? (
						<Notice>
							<span className="asyncy-btn-spinner" aria-label="Loading" />
						</Notice>
					) : null}
				</div>
			</div>
		</div>
	);
}

export function FileViewerModalHost() {
	const file = useFileViewerStore((s) => s.file);
	const close = useFileViewerStore((s) => s.close);
	if (!file) return null;
	return createPortal(<FileViewerModal key={`${file.result.path}:${file.ref.line ?? ""}`} file={file} onClose={close} />, document.body);
}
