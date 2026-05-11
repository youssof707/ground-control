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

/**
 * Returns true when the live branch (`branch`) differs from the branch
 * captured when the user last sent a message in the session. Used to
 * flip BranchChip into its red ("stale") state. Returns false when either
 * side is missing — without a baseline (e.g. a freshly created session
 * where the user hasn't sent anything yet) there's nothing to compare.
 */
export function isBranchStale(s: {
	branch?: string;
	lastUserMessageBranch?: string;
}): boolean {
	return (
		!!s.lastUserMessageBranch &&
		!!s.branch &&
		s.branch !== s.lastUserMessageBranch
	);
}

export function BranchChip({
	name,
	stale = false,
	staleFrom,
}: {
	name: string;
	stale?: boolean;
	/** Branch name the session last sent on; surfaced in the tooltip when stale. */
	staleFrom?: string;
}) {
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

	const baseTitle = copied
		? "Copied!"
		: stale
			? staleFrom
				? `Branch changed since last message (was "${staleFrom}") — click to copy "${name}"`
				: `Branch changed since last message — click to copy "${name}"`
			: `Copy "${name}"`;

	// Resting palette: green when freshly copied, red when stale, otherwise
	// the normal subdued chip. Hover handlers below mirror this priority.
	const restingBg = copied ? T.okSoft : stale ? T.dangerSoft : T.surface;
	const restingBorder = copied ? T.okBorder : stale ? T.dangerBorder : T.border;
	const restingColor = copied ? T.ok : stale ? T.danger : T.textDim;

	return (
		<button
			type="button"
			onClick={onClick}
			title={baseTitle}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px 0 7px",
				borderRadius: 11,
				background: restingBg,
				border: `0.5px solid ${restingBorder}`,
				fontSize: 11.5,
				color: restingColor,
				fontFamily: T.mono,
				whiteSpace: "nowrap",
				maxWidth: 200,
				overflow: "hidden",
				textOverflow: "ellipsis",
				cursor: "pointer",
				transition: "background 0.12s, color 0.12s, border-color 0.12s",
			}}
			onMouseEnter={(e) => {
				if (copied || stale) return;
				e.currentTarget.style.background = T.surfaceHi;
				e.currentTarget.style.color = T.text;
			}}
			onMouseLeave={(e) => {
				if (copied || stale) return;
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

/**
 * Small ghost-style button that runs `git switch <baseline>` in a session's
 * cwd, clearing the chip's red state. Owns its own loading + error state so
 * `BranchChipWithDelta` can stay a thin presentational wrapper.
 *
 * On failure (e.g. uncommitted changes, branch missing) the button briefly
 * flips to a red "failed" label with the git error message in the tooltip,
 * then resets after a few seconds so the user can retry.
 */
function BranchSwitchButton({
	sessionId,
	branch,
}: {
	sessionId: string;
	branch: string;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (busy) return;
		setError(null);
		setBusy(true);
		try {
			await window.claude.switchBranch(sessionId, branch);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
			setTimeout(() => setError(null), 5000);
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			title={error ? error : `Switch the working tree back to "${branch}"`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				height: 18,
				padding: "0 7px",
				borderRadius: 9,
				background: error ? T.dangerSoft : "transparent",
				border: `0.5px solid ${error ? T.dangerBorder : T.border}`,
				fontSize: 10.5,
				color: error ? T.danger : T.textDim,
				fontFamily: T.sans,
				whiteSpace: "nowrap",
				cursor: busy ? "default" : "pointer",
				transition: "background 0.12s, color 0.12s, border-color 0.12s",
			}}
			onMouseEnter={(e) => {
				if (busy || error) return;
				e.currentTarget.style.background = T.surfaceHi;
				e.currentTarget.style.color = T.text;
			}}
			onMouseLeave={(e) => {
				if (busy || error) return;
				e.currentTarget.style.background = "transparent";
				e.currentTarget.style.color = T.textDim;
			}}
		>
			{busy ? "switching…" : error ? "failed" : "Switch"}
		</button>
	);
}

/**
 * The BranchChip plus, when stale, a subtle "Previously working on X" hint
 * and a one-click Switch button to take the working tree back to that
 * baseline branch. The hint + button only render when the pill is in its
 * red ("stale") state.
 *
 * Renders inline (Fragment): parents must already lay out the chip area
 * with their own flex / gap. Returns null when `branch` is undefined so
 * callers don't need to gate on it themselves.
 *
 * Pass `sessionId` to enable the Switch button — without it the hint shows
 * but no button. Useful for read-only contexts (e.g. diff headers) where
 * mutating the working tree mid-view would be surprising.
 */
export function BranchChipWithDelta({
	branch,
	lastUserMessageBranch,
	sessionId,
	showCurrentHint = true,
}: {
	branch?: string;
	lastUserMessageBranch?: string;
	/** When provided alongside `showCurrentHint`, renders a Switch button
	 * after the hint that runs `git switch <lastUserMessageBranch>`. */
	sessionId?: string;
	/** Show the "Previously working on X" hint (and the Switch button if
	 * `sessionId` is also provided) when stale. Default true; pass false in
	 * tight layouts where the extra text would overflow. */
	showCurrentHint?: boolean;
}) {
	if (!branch) return null;
	const stale = isBranchStale({ branch, lastUserMessageBranch });
	const showHint = stale && showCurrentHint && !!lastUserMessageBranch;
	return (
		<>
			<BranchChip
				name={branch}
				stale={stale}
				staleFrom={lastUserMessageBranch}
			/>
			{showHint ? (
				<span
					style={{
						fontSize: 11,
						color: T.textFaint,
						fontFamily: T.mono,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					Previously working on {lastUserMessageBranch}
				</span>
			) : null}
			{showHint && sessionId && lastUserMessageBranch ? (
				<BranchSwitchButton
					sessionId={sessionId}
					branch={lastUserMessageBranch}
				/>
			) : null}
		</>
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

// ─── Minimize toggle ─────────────────────────────────────────────────────────

/**
 * Disclosure-triangle button used to hide/show the body of an inline
 * permission card (both the sessions-list row and the inbox sidebar entry).
 * Pointing right when minimized, down when expanded — matches the Finder /
 * VS Code disclosure convention.
 *
 * Always `e.preventDefault()` + `e.stopPropagation()` because both call sites
 * wrap the surrounding region in a `<Link>` — without it the click navigates
 * into the session instead of toggling visibility.
 */
export function MinimizeToggle({
	minimized,
	onToggle,
	count,
}: {
	minimized: boolean;
	onToggle: () => void;
	count: number;
}) {
	const noun = count === 1 ? "card" : "cards";
	const title = minimized
		? `Show ${count} pending permission ${noun}`
		: `Hide ${count} pending permission ${noun}`;
	return (
		<button
			type="button"
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onToggle();
			}}
			title={title}
			aria-label={title}
			aria-expanded={!minimized}
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 20,
				height: 20,
				border: "none",
				background: "transparent",
				color: T.textDim,
				cursor: "pointer",
				borderRadius: 4,
				padding: 0,
				transform: minimized ? "rotate(-90deg)" : "rotate(0deg)",
				transition: "transform 120ms ease, background 120ms, color 120ms",
				flexShrink: 0,
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = T.accentSoft;
				e.currentTarget.style.color = T.accent;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
				e.currentTarget.style.color = T.textDim;
			}}
		>
			<svg
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M2 3.5L5 6.5L8 3.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
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
