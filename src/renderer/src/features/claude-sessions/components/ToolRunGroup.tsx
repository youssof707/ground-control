import { memo } from "react";
import { T } from "../../../design/tokens";
import {
	ToolUsePill,
	ToolResultPill,
	RawBlock,
	type ContentBlock,
} from "./MessageView";

interface ToolRunEntry {
	messageId: string;
	blockIndex: number;
	block: ContentBlock;
}

// Renders a contiguous run of tool_use + tool_result blocks (possibly
// spanning multiple consecutive tool-only messages) as a single dim,
// collapsed line — analogous to Claude Code's collapsed "thinking"
// indicator. Click the line to expand and reveal each individual pill,
// which themselves remain individually expandable (existing behavior).
export const ToolRunGroup = memo(function ToolRunGroup({
	entries,
}: {
	entries: ToolRunEntry[];
}) {
	const callCount = entries.filter((e) => e.block.type === "tool_use").length;
	const hasThinking = entries.some(
		(e) => e.block.type === "thinking" || e.block.type === "redacted_thinking",
	);
	// Unique tool names (preserve first-seen order), capped at 3 with an
	// ellipsis if there are more, e.g. "Bash, Read, Grep, …". Thinking is
	// appended as its own marker so the summary stays honest about what's
	// inside.
	const seen = new Set<string>();
	const names: string[] = [];
	for (const e of entries) {
		if (e.block.type !== "tool_use") continue;
		const n = e.block.name ?? "tool";
		if (seen.has(n)) continue;
		seen.add(n);
		names.push(n);
	}
	const toolNames =
		names.length === 0
			? ""
			: names.length <= 3
				? names.join(", ")
				: `${names.slice(0, 3).join(", ")}, …`;
	const namePreview = [toolNames, hasThinking ? "thinking" : ""]
		.filter(Boolean)
		.join(" · ");

	const label =
		callCount === 1 ? "1 tool call" : `${callCount} tool calls`;

	return (
		<div
			style={{
				display: "flex",
				gap: 14,
				marginBottom: 12,
				maxWidth: 760,
				marginLeft: "auto",
				marginRight: "auto",
			}}
		>
			{/* Avatar gutter — keeps inner pills aligned with normal messages
			    when expanded. */}
			<div style={{ width: 28, flexShrink: 0 }} />
			<div style={{ flex: 1, minWidth: 0 }}>
				<details>
					<summary
						style={{
							cursor: "pointer",
							listStyle: "none",
							display: "flex",
							alignItems: "center",
							gap: 8,
							fontSize: 12,
							fontFamily: T.mono,
							color: T.textFaint,
							padding: "2px 0",
							userSelect: "none",
						}}
					>
						<Chevron />
						<span>{label}</span>
						{namePreview ? (
							<>
								<span style={{ color: T.textFaint }}>·</span>
								<span
									style={{
										color: T.textMute,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										minWidth: 0,
									}}
								>
									{namePreview}
								</span>
							</>
						) : null}
					</summary>
					<div style={{ marginTop: 8 }}>
						{entries.map((e) => {
							const key = `${e.messageId}:${e.blockIndex}`;
							if (e.block.type === "tool_use") {
								return <ToolUsePill key={key} block={e.block} />;
							}
							if (e.block.type === "tool_result") {
								return <ToolResultPill key={key} block={e.block} />;
							}
							// thinking / redacted_thinking — match the same visual
							// treatment MessageView gives them (RawBlock) so users
							// see the same expandable line they're used to.
							return <RawBlock key={key} block={e.block} />;
						})}
					</div>
				</details>
			</div>
		</div>
	);
});

function Chevron() {
	// Tiny right-pointing arrow that rotates when <details> is open via the
	// adjacent CSS selector defined inline below. Pure SVG, no extra state.
	return (
		<svg
			width="9"
			height="9"
			viewBox="0 0 10 10"
			fill="none"
			style={{ flexShrink: 0, color: T.textFaint }}
			aria-hidden="true"
		>
			<path
				d="M3.5 2.5L6.5 5L3.5 7.5"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
