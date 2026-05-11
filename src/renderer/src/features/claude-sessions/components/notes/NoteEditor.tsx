import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { T } from "../../../../design/tokens";

/**
 * Thin TipTap wrapper. Treats markdown as **uncontrolled** after initial
 * mount — `initialMarkdown` is loaded once and the editor owns the text
 * from then on. Re-setting content on every prop change would jump the
 * caret on each debounced save.
 *
 * `immediatelyRender: false` is mandatory under React 19 StrictMode
 * (enabled in src/renderer/src/main.tsx). Without it the editor is
 * created + destroyed + recreated on first mount, producing "Selection
 * out of bounds" warnings and an aborted initial render.
 *
 * Auto-save: caller passes onChange and handles debouncing. We additionally
 * call `flushPending()` on unmount via an exposed imperative hook on the
 * onChange callback — see `NoteCard` for the debounce contract.
 */
export function NoteEditor({
	initialMarkdown,
	onChange,
	onBlur,
	onFlushNeededRef,
	autoFocus,
}: {
	initialMarkdown: string;
	onChange: (markdown: string) => void;
	/**
	 * Fires when the editor loses focus. NoteCard uses this to auto-save
	 * on blur (clicking outside the card commits the edit, same as
	 * clicking the explicit checkmark button).
	 */
	onBlur?: (markdown: string) => void;
	/**
	 * NoteCard passes a ref it owns; on unmount NoteCard reads the latest
	 * markdown from this getter and flushes a final save through onChange.
	 * Lets the parent fire one last write without round-tripping through
	 * a state update.
	 */
	onFlushNeededRef?: React.MutableRefObject<(() => string | null) | null>;
	autoFocus?: boolean;
}) {
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onBlurRef = useRef(onBlur);
	onBlurRef.current = onBlur;

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				// StarterKit ships sensible defaults. Keep it minimal — anything
				// that doesn't round-trip cleanly through markdown should be off.
			}),
			Markdown.configure({
				html: false,
				tightLists: true,
				linkify: true,
				breaks: false,
				transformPastedText: true,
				transformCopiedText: true,
			}),
			Placeholder.configure({
				placeholder: "Write a note…",
			}),
		],
		content: initialMarkdown || "",
		editorProps: {
			attributes: {
				class: "note-editor-content",
				spellcheck: "true",
			},
		},
		onUpdate: ({ editor }) => {
			// Storage is added by the Markdown extension. The cast is local to
			// keep the rest of the codebase strict.
			const storage = editor.storage as {
				markdown?: { getMarkdown: () => string };
			};
			const md = storage.markdown?.getMarkdown() ?? editor.getText();
			onChangeRef.current(md);
		},
		onBlur: ({ editor }) => {
			if (!onBlurRef.current) return;
			const storage = editor.storage as {
				markdown?: { getMarkdown: () => string };
			};
			const md = storage.markdown?.getMarkdown() ?? editor.getText();
			onBlurRef.current(md);
		},
	});

	// Expose a flush-getter to the parent so it can grab the latest markdown
	// before the editor is destroyed. Used in NoteCard's unmount cleanup to
	// emit one final onChange (which the parent's debounce treats as
	// "flush now").
	useEffect(() => {
		if (!onFlushNeededRef) return;
		onFlushNeededRef.current = () => {
			if (!editor) return null;
			const storage = editor.storage as {
				markdown?: { getMarkdown: () => string };
			};
			return storage.markdown?.getMarkdown() ?? editor.getText();
		};
		return () => {
			if (onFlushNeededRef.current) onFlushNeededRef.current = null;
		};
	}, [editor, onFlushNeededRef]);

	// One-shot autofocus on mount. Place caret at end so a newly-created
	// empty note doesn't show the placeholder under the caret.
	const didAutoFocus = useRef(false);
	useEffect(() => {
		if (!editor || !autoFocus || didAutoFocus.current) return;
		didAutoFocus.current = true;
		editor.commands.focus("end");
	}, [editor, autoFocus]);

	return (
		<div
			style={{
				background: T.surfaceLow,
				border: `0.5px solid ${T.borderSoft}`,
				borderRadius: 8,
				padding: "10px 12px",
				fontSize: 13.5,
				color: T.text,
				lineHeight: 1.55,
			}}
		>
			<EditorContent editor={editor} />
		</div>
	);
}
