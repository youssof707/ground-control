import { useEffect, useRef, useState } from "react";
import { useBackdropDismiss } from "../../components/useBackdropDismiss";
import { T } from "../../design/tokens";
import { plural } from "./format";

export function CommitModal({
	all,
	count,
	onConfirm,
	onCancel,
}: {
	all: boolean;
	count: number;
	onConfirm: (message: string) => void;
	onCancel: () => void;
}) {
	const [message, setMessage] = useState("");
	const messageRef = useRef(message);
	messageRef.current = message;
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const backdropProps = useBackdropDismiss(onCancel);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.isComposing) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onCancel();
				return;
			}
			if (e.key !== "Enter") return;
			e.preventDefault();
			e.stopPropagation();
			if (e.metaKey || e.ctrlKey) {
				const input = inputRef.current;
				if (!input) return;
				if (document.activeElement !== input) input.focus();
				document.execCommand("insertText", false, "\n");
				return;
			}
			onConfirm(messageRef.current);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onConfirm, onCancel]);

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="scm-commit-title">
				<h2 id="scm-commit-title" className="modal-title">
					{all ? "Stage and commit" : "Commit"} {plural(count, all ? "file" : "staged file", all ? "files" : "staged files")}
				</h2>
				<textarea
					ref={inputRef}
					autoFocus
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					placeholder="Commit message. Leave blank and Sonnet writes one."
					aria-label="Commit message"
					rows={5}
					spellCheck={false}
					style={{
						display: "block",
						width: "100%",
						boxSizing: "border-box",
						margin: "4px 0 8px",
						padding: "9px 11px",
						resize: "vertical",
						minHeight: 72,
						maxHeight: "50vh",
						fontSize: 13,
						lineHeight: 1.5,
						background: T.bg,
						border: `0.5px solid ${T.border}`,
						borderRadius: 8,
					}}
				/>
				<div style={{ margin: "0 0 16px", fontSize: 11.5, color: T.textFaint }}>
					Enter commits. ⌘Enter adds a new line.
				</div>
				<div className="modal-actions">
					<button type="button" className="btn" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="btn btn-primary" onClick={() => onConfirm(messageRef.current)}>
						Commit
					</button>
				</div>
			</div>
		</div>
	);
}
