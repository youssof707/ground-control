import { useState, type CSSProperties, type ReactNode } from "react";
import { T } from "./tokens";

// ─── StatusPill ──────────────────────────────────────────────────────────────

interface StatusStyle {
	dot: string;
	label: string;
	color: string;
	bg: string;
	border: string;
	pulse?: boolean;
}

const STATUS_MAP: Record<string, StatusStyle> = {
	idle: {
		dot: T.textMute,
		label: "idle",
		color: T.textDim,
		bg: "transparent",
		border: T.border,
	},
	running: {
		dot: T.ok,
		label: "running",
		color: T.ok,
		bg: T.okSoft,
		border: T.okBorder,
		pulse: true,
	},
	awaiting_permission: {
		dot: T.accent,
		label: "waiting for input",
		color: T.accent,
		bg: T.accentSoft,
		border: T.accentBorder,
	},
	done: {
		dot: T.info,
		label: "done",
		color: T.info,
		bg: T.infoSoft,
		border: T.infoBorder,
	},
	cancelled: {
		dot: T.textMute,
		label: "cancelled",
		color: T.textDim,
		bg: T.surface,
		border: T.border,
	},
	errored: {
		dot: T.danger,
		label: "errored",
		color: T.danger,
		bg: T.dangerSoft,
		border: T.dangerBorder,
	},
};

export function StatusPill({ status }: { status: string }) {
	const map = STATUS_MAP[status] ?? STATUS_MAP.idle;
	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: map.bg,
				border: `0.5px solid ${map.border}`,
				fontSize: 11.5,
				color: map.color,
				fontWeight: 500,
				letterSpacing: "0.1px",
				whiteSpace: "nowrap",
			}}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: map.dot,
					boxShadow: map.pulse ? `0 0 0 3px ${T.okSoft}` : "none",
				}}
			/>
			{map.label}
		</div>
	);
}

// ─── BranchChip ──────────────────────────────────────────────────────────────

export function BranchChip({ name }: { name: string }) {
	const [copied, setCopied] = useState(false);

	const onClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(name);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			// noop — clipboard write can fail in some contexts
		}
	};

	return (
		<button
			type="button"
			onClick={onClick}
			title={copied ? "Copied!" : `Copy "${name}"`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px 0 7px",
				borderRadius: 11,
				background: copied ? T.okSoft : T.surface,
				border: `0.5px solid ${copied ? T.okBorder : T.border}`,
				fontSize: 11.5,
				color: copied ? T.ok : T.textDim,
				fontFamily: T.mono,
				whiteSpace: "nowrap",
				maxWidth: 200,
				overflow: "hidden",
				textOverflow: "ellipsis",
				cursor: "pointer",
				transition: "background 0.12s, color 0.12s, border-color 0.12s",
			}}
			onMouseEnter={(e) => {
				if (copied) return;
				e.currentTarget.style.background = T.surfaceHi;
				e.currentTarget.style.color = T.text;
			}}
			onMouseLeave={(e) => {
				if (copied) return;
				e.currentTarget.style.background = T.surface;
				e.currentTarget.style.color = T.textDim;
			}}
		>
			{copied ? (
				<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
					<path
						d="M2.5 6.5l2.5 2.5 4.5-5"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
					<circle cx="3" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1" />
					<circle cx="3" cy="9.5" r="1.3" stroke="currentColor" strokeWidth="1" />
					<circle cx="9" cy="3.5" r="1.3" stroke="currentColor" strokeWidth="1" />
					<path
						d="M3 4v4M3 8c0-2 6-2 6-4"
						stroke="currentColor"
						strokeWidth="1"
						fill="none"
					/>
				</svg>
			)}
			<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
				{copied ? "Copied" : name}
			</span>
		</button>
	);
}

// ─── Kbd ─────────────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
	return <span className="kbd">{children}</span>;
}

// ─── Inline code in transcript ───────────────────────────────────────────────

export function InlineCode({ children }: { children: ReactNode }) {
	return (
		<code
			style={{
				fontFamily: T.mono,
				fontSize: 12.5,
				padding: "1px 6px",
				borderRadius: 4,
				background: T.surfaceHi,
				color: T.text,
				border: `0.5px solid ${T.borderSoft}`,
			}}
		>
			{children}
		</code>
	);
}

// ─── Section eyebrow ─────────────────────────────────────────────────────────

export function Eyebrow({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}) {
	return (
		<div
			style={{
				fontSize: 11.5,
				fontWeight: 600,
				color: T.textMute,
				letterSpacing: 1,
				textTransform: "uppercase",
				...style,
			}}
		>
			{children}
		</div>
	);
}
