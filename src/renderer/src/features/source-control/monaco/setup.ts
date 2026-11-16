import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/codeEditor/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/languages/definitions/register.all";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { buildTheme, THEME_NAME } from "./theme";

let workerFailed = false;
const failureListeners = new Set<() => void>();

function markWorkerFailed(): void {
	if (workerFailed) return;
	workerFailed = true;
	for (const fn of failureListeners) fn();
}

self.MonacoEnvironment = {
	getWorker: () => {
		try {
			const worker = new EditorWorker();
			worker.addEventListener("error", markWorkerFailed);
			return worker;
		} catch (err) {
			markWorkerFailed();
			throw err;
		}
	},
};

monaco.editor.defineTheme(THEME_NAME, buildTheme());

export function editorWorkerFailed(): boolean {
	return workerFailed;
}

export function onEditorWorkerFailure(fn: () => void): () => void {
	failureListeners.add(fn);
	return () => {
		failureListeners.delete(fn);
	};
}

const byExtension = new Map<string, string>();
const byFilename = new Map<string, string>();

function indexLanguages(): void {
	if (byExtension.size > 0) return;
	for (const lang of monaco.languages.getLanguages()) {
		for (const ext of lang.extensions ?? []) {
			if (!byExtension.has(ext.toLowerCase())) byExtension.set(ext.toLowerCase(), lang.id);
		}
		for (const name of lang.filenames ?? []) {
			if (!byFilename.has(name.toLowerCase())) byFilename.set(name.toLowerCase(), lang.id);
		}
	}
}

export function languageFor(path: string): string {
	indexLanguages();
	const name = (path.split("/").pop() ?? path).toLowerCase();
	const exact = byFilename.get(name);
	if (exact) return exact;
	let dot = name.indexOf(".");
	while (dot !== -1) {
		const found = byExtension.get(name.slice(dot));
		if (found) return found;
		dot = name.indexOf(".", dot + 1);
	}
	return "plaintext";
}

export { monaco, THEME_NAME };
