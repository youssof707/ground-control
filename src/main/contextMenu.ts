import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

const MAX_SUGGESTIONS = 6;

/**
 * Native right-click menu. Electron ships with none: Chromium still draws the
 * red spellcheck underline, but right-clicking does nothing unless main builds
 * a menu from the `context-menu` event. This gives text fields the usual macOS
 * spelling suggestions + Cut/Copy/Paste, and Copy on selected non-editable text.
 *
 * Renderer handlers that `preventDefault()` the DOM `contextmenu` event (e.g.
 * the sidebar "+" button) suppress this event, so they keep their own behavior.
 */
export function attachContextMenu(win: BrowserWindow): void {
	const wc = win.webContents;
	wc.on("context-menu", (_event, params) => {
		const items: MenuItemConstructorOptions[] = [];

		if (params.isEditable && params.misspelledWord) {
			const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
			if (suggestions.length === 0) {
				items.push({ label: "No Guesses Found", enabled: false });
			} else {
				for (const suggestion of suggestions) {
					items.push({
						label: suggestion,
						click: () => wc.replaceMisspelling(suggestion),
					});
				}
			}
			items.push(
				{ type: "separator" },
				{
					label: "Learn Spelling",
					click: () =>
						wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
				},
				{ type: "separator" },
			);
		}

		if (params.isEditable) {
			const flags = params.editFlags;
			items.push(
				{ role: "cut", enabled: flags.canCut },
				{ role: "copy", enabled: flags.canCopy },
				{ role: "paste", enabled: flags.canPaste },
				{ type: "separator" },
				{ role: "selectAll", enabled: flags.canSelectAll },
			);
		} else if (params.selectionText.trim()) {
			items.push({ role: "copy" });
		}

		if (items.length === 0) return;
		Menu.buildFromTemplate(items).popup({ window: win });
	});
}
