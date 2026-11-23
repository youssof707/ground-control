import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { lineLabel } from "./reviewPrompt";

export function ReviewBox({
	startLine,
	endLine,
	body,
	initialText,
	onTextChange,
	onSave,
	onCancel,
	onDelete,
	onHeight,
}: {
	startLine: number;
	endLine: number;
	body: string | null;
	initialText?: string;
	onTextChange?: (text: string) => void;
	onSave: (body: string) => void;
	onCancel: () => void;
	onDelete?: () => void;
	onHeight: (height: number) => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [editing, setEditing] = useState(body === null);
	const [text, setText] = useState(body ?? initialText ?? "");

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const report = (): void => onHeight(Math.ceil(root.getBoundingClientRect().height) + 8);
		report();
		const observer = new ResizeObserver(report);
		observer.observe(root);
		return () => observer.disconnect();
	}, [onHeight]);

	useLayoutEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "0px";
		input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
	}, [text, editing]);

	useEffect(() => {
		if (editing) inputRef.current?.focus({ preventScroll: true });
	}, [editing]);

	const save = (): void => {
		const trimmed = text.trim();
		if (!trimmed) return;
		onSave(trimmed);
		if (body !== null) setEditing(false);
	};

	const cancel = (): void => {
		if (body === null) {
			onCancel();
			return;
		}
		setText(body);
		setEditing(false);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (e.key === "Enter" && !e.nativeEvent.isComposing) {
			e.preventDefault();
			if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
				save();
				return;
			}
			const input = e.currentTarget;
			const next = `${text.slice(0, input.selectionStart)}\n${text.slice(input.selectionEnd)}`;
			const caret = input.selectionStart + 1;
			setText(next);
			onTextChange?.(next);
			requestAnimationFrame(() => input.setSelectionRange(caret, caret));
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
	};

	return (
		<div ref={rootRef} className="scm-review-box">
			{editing ? (
				<>
					<textarea
						ref={inputRef}
						className="scm-review-input"
						value={text}
						placeholder={`Comment on ${lineLabel(startLine, endLine).toLowerCase()}`}
						aria-label={`Comment on ${lineLabel(startLine, endLine).toLowerCase()}`}
						onChange={(e) => {
							setText(e.target.value);
							onTextChange?.(e.target.value);
						}}
						onKeyDown={onKeyDown}
					/>
					<div className="scm-review-actions">
						<span className="scm-review-hint">↵</span>
						<button type="button" className="scm-review-btn" onClick={cancel}>
							Cancel
						</button>
						<button
							type="button"
							className="scm-review-btn is-primary"
							disabled={!text.trim()}
							onClick={save}
						>
							{body === null ? "Comment" : "Save"}
						</button>
					</div>
				</>
			) : (
				<>
					<div className="scm-review-head">
						<span>{lineLabel(startLine, endLine)}</span>
						<span style={{ flex: 1 }} />
						<button type="button" className="scm-review-btn" onClick={() => setEditing(true)}>
							Edit
						</button>
						<button type="button" className="scm-review-btn" onClick={onDelete}>
							Delete
						</button>
					</div>
					<div className="scm-review-body">{body}</div>
				</>
			)}
		</div>
	);
}
