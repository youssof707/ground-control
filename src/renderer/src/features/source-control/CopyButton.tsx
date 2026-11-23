import { useEffect, useState } from "react";

function CopyIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.1" />
			<path d="M8 2H3.2A1.2 1.2 0 0 0 2 3.2V8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
		</svg>
	);
}

function DoneIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M2.5 6.2L5 8.6L9.5 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function CopyButton({ text, label, iconOnly = false }: { text: string; label: string; iconOnly?: boolean }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1200);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			className={`btn btn-ghost branch-copy${iconOnly ? " branch-copy-icon" : ""}${copied ? " branch-copy-done" : ""}`}
			aria-label={copied ? "Copied" : label}
			onClick={() => {
				navigator.clipboard.writeText(text).then(
					() => setCopied(true),
					() => setCopied(false),
				);
			}}
		>
			{copied ? <DoneIcon /> : <CopyIcon />}
			{iconOnly ? null : <span>{copied ? "Copied" : "Copy"}</span>}
		</button>
	);
}
