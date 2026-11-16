import type * as Monaco from "monaco-editor/editor/editor.api";
import { T } from "../../../design/tokens";
import { oklchToHex } from "../oklch";

export const THEME_NAME = "gc-dark";

const SYNTAX = {
	keyword: "oklch(0.78 0.14 320)",
	string: "oklch(0.85 0.13 90)",
	number: "oklch(0.80 0.10 220)",
	comment: "oklch(0.70 0.025 85)",
	type: "oklch(0.85 0.09 220)",
	variable: "oklch(0.80 0.13 50)",
};

function fg(color: string): string {
	return oklchToHex(color).slice(1, 7);
}

export function buildTheme(): Monaco.editor.IStandaloneThemeData {
	const hex = (color: string, alpha?: number): string => oklchToHex(color, alpha);
	return {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "", foreground: fg(T.text) },
			{ token: "keyword", foreground: fg(SYNTAX.keyword) },
			{ token: "string", foreground: fg(SYNTAX.string) },
			{ token: "number", foreground: fg(SYNTAX.number) },
			{ token: "comment", foreground: fg(SYNTAX.comment) },
			{ token: "type", foreground: fg(SYNTAX.type) },
			{ token: "type.identifier", foreground: fg(SYNTAX.type) },
			{ token: "tag", foreground: fg(SYNTAX.variable) },
			{ token: "attribute.name", foreground: fg(SYNTAX.string) },
			{ token: "variable", foreground: fg(SYNTAX.variable) },
			{ token: "delimiter", foreground: fg(T.textDim) },
		],
		colors: {
			"editor.background": hex(T.win),
			"editor.foreground": hex(T.text),
			"editorLineNumber.foreground": hex(T.textFaint),
			"editorLineNumber.activeForeground": hex(T.textDim),
			"editor.lineHighlightBackground": hex(T.surface),
			"editor.lineHighlightBorder": hex(T.surface),
			"editor.selectionBackground": hex(T.accent, 0.28),
			"editor.inactiveSelectionBackground": hex(T.accent, 0.16),
			"editorCursor.foreground": hex(T.accent),
			"editorGutter.background": hex(T.win),
			"editorWidget.background": hex(T.surface),
			"editorWidget.border": hex(T.border),
			"input.background": hex(T.bg),
			"input.border": hex(T.border),
			"focusBorder": hex(T.accent, 0.5),
			"scrollbar.shadow": "#00000000",
			"scrollbarSlider.background": hex(T.border, 0.7),
			"scrollbarSlider.hoverBackground": hex(T.border),
			"scrollbarSlider.activeBackground": hex(T.textFaint),
			"diffEditor.insertedTextBackground": hex(T.ok, 0.16),
			"diffEditor.removedTextBackground": hex(T.danger, 0.18),
			"diffEditor.insertedLineBackground": hex(T.ok, 0.08),
			"diffEditor.removedLineBackground": hex(T.danger, 0.09),
			"diffEditorGutter.insertedLineBackground": hex(T.ok, 0.14),
			"diffEditorGutter.removedLineBackground": hex(T.danger, 0.16),
			"diffEditor.diagonalFill": hex(T.borderSoft),
			"diffEditor.unchangedRegionBackground": hex(T.surfaceLow),
			"diffEditor.unchangedRegionForeground": hex(T.textMute),
			"diffEditor.unchangedCodeBackground": "#00000000",
			"diffEditor.border": hex(T.borderSoft),
		},
	};
}
