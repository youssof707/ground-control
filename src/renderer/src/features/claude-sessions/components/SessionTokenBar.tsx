import { useMemo } from "react";
import type {
	ClaudeSessionFull,
	SessionMessage,
} from "@shared/schemas/claude_session";
import { T } from "../../../design/tokens";

// ─── Shapes pulled from the Claude Agent SDK message stream ──────────────────

interface ResultUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface ResultContent {
	type: "result";
	usage?: ResultUsage;
}

function isResult(
	m: SessionMessage,
): m is SessionMessage & { content: ResultContent } {
	if (m.role !== "result") return false;
	const c = m.content;
	return (
		typeof c === "object" &&
		c !== null &&
		(c as { type?: unknown }).type === "result"
	);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SessionTokenBar({
	session,
}: {
	session: ClaudeSessionFull;
}) {
	const totalTokens = useMemo(() => {
		// Per-turn `result` messages from the SDK report usage for that turn
		// only (verified empirically against persisted sessions), so we sum
		// them to get the session-wide total.
		let totalIn = 0;
		let totalOut = 0;
		let totalCacheRead = 0;
		let totalCacheCreation = 0;
		for (const m of session.messages) {
			if (!isResult(m)) continue;
			const u = m.content.usage;
			if (!u) continue;
			totalIn += u.input_tokens ?? 0;
			totalOut += u.output_tokens ?? 0;
			totalCacheRead += u.cache_read_input_tokens ?? 0;
			totalCacheCreation += u.cache_creation_input_tokens ?? 0;
		}
		return totalIn + totalOut + totalCacheRead + totalCacheCreation;
	}, [session.messages]);

	return (
		<div
			style={{
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				gap: 16,
				padding: "4px 32px 6px",
				fontSize: 11,
				fontFamily: T.mono,
				color: T.textMute,
				borderTop: `0.5px solid ${T.borderSoft}`,
				background: T.surfaceLow,
				userSelect: "none",
			}}
			title={`Session total: ${totalTokens.toLocaleString()} tokens`}
		>
			<div
				style={{
					maxWidth: 760,
					margin: "0 auto",
					width: "100%",
					display: "flex",
					alignItems: "center",
				}}
			>
				<span style={{ color: T.textDim }}>{fmtTokens(totalTokens)} tok</span>
			</div>
		</div>
	);
}
