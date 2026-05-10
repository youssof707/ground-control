import { useState, type CSSProperties, type ReactNode } from "react";
import { T } from "./tokens";
import type { SessionMode } from "@shared/claude-sessions/types";

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

// ─── ModeChip ────────────────────────────────────────────────────────────────

const MODE_LABEL: Record<SessionMode, string> = {
	plan: "Plan",
	acceptEdits: "Auto-edit",
};

function modeColors(mode: SessionMode): {
	color: string;
	bg: string;
	border: string;
} {
	if (mode === "plan") {
		return { color: T.info, bg: T.infoSoft, border: T.infoBorder };
	}
	return { color: T.warn, bg: T.warnSoft, border: T.warnBorder };
}

/** Read-only chip showing a session's current mode. */
export function ModeChip({ mode }: { mode: SessionMode }) {
	const c = modeColors(mode);
	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: c.bg,
				border: `0.5px solid ${c.border}`,
				color: c.color,
				fontSize: 11.5,
				fontWeight: 500,
				whiteSpace: "nowrap",
			}}
		>
			{MODE_LABEL[mode]}
		</div>
	);
}

// ─── ModeToggle ──────────────────────────────────────────────────────────────

/**
 * Segmented two-state toggle for session mode. Intentionally subdued — no
 * status color, just neutral text. Lives in the composer footer so it sits
 * close to where the user types; it should read as a setting, not a status
 * pill. Optimistic — the caller is expected to flip the local store
 * immediately and reconcile on error.
 */
export function ModeToggle({
	mode,
	onChange,
	disabled,
}: {
	mode: SessionMode;
	onChange: (next: SessionMode) => void;
	disabled?: boolean;
}) {
	return (
		<div
			role="group"
			aria-label="Session mode"
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: 24,
				padding: 2,
				borderRadius: 8,
				background: "transparent",
				border: `0.5px solid ${T.borderSoft}`,
				opacity: disabled ? 0.6 : 1,
			}}
		>
			<ModeToggleButton
				active={mode === "plan"}
				disabled={disabled}
				onClick={() => mode !== "plan" && onChange("plan")}
				title="Plan mode: Claude won't make edits, just researches and plans."
			>
				Plan
			</ModeToggleButton>
			<ModeToggleButton
				active={mode === "acceptEdits"}
				disabled={disabled}
				onClick={() => mode !== "acceptEdits" && onChange("acceptEdits")}
				title="Auto-edit mode: file edits run without asking. Other tools still prompt."
			>
				Auto-edit
			</ModeToggleButton>
		</div>
	);
}

function ModeToggleButton({
	active,
	disabled,
	onClick,
	title,
	children,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			style={{
				height: 20,
				padding: "0 8px",
				borderRadius: 6,
				border: "0.5px solid transparent",
				background: active ? T.surfaceHi : "transparent",
				color: active ? T.text : T.textFaint,
				fontSize: 11.5,
				fontWeight: active ? 500 : 400,
				cursor: disabled ? "default" : "pointer",
				whiteSpace: "nowrap",
				transition: "background 0.12s, color 0.12s",
			}}
		>
			{children}
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
