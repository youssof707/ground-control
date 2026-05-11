import { useState } from "react";
import type { SessionMessage } from "@shared/claude-sessions/types";
import { MarkdownText } from "./MarkdownText";
import { T } from "../../../design/tokens";

interface SdkLike {
	type?: string;
	subtype?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
	[k: string]: unknown;
}

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	input?: unknown;
	id?: string;
	tool_use_id?: string;
	is_error?: boolean;
	content?: unknown;
	source?: { media_type?: string; data?: string; type?: string };
	[k: string]: unknown;
}

export function MessageView({
	m,
	onFork,
	forkPending,
}: {
	m: SessionMessage;
	onFork?: (messageId: string) => void;
	forkPending?: boolean;
}) {
	const sdk = m.content as SdkLike;
	if (m.role === "assistant") {
		return (
			<AssistantMessage
				sdk={sdk}
				messageId={m.id}
				onFork={onFork}
				forkPending={forkPending}
			/>
		);
	}
	if (m.role === "user") return <UserMessage sdk={sdk} />;
	if (m.role === "system") return null;
	if (m.role === "result") return null;
	return null;
}

function AssistantMessage({
	sdk,
	messageId,
	onFork,
	forkPending,
}: {
	sdk: SdkLike;
	messageId: string;
	onFork?: (messageId: string) => void;
	forkPending?: boolean;
}) {
	const [hovered, setHovered] = useState(false);
	const blocks = (sdk.message?.content as ContentBlock[] | undefined) ?? [];
	if (blocks.length === 0) return null;
	// Fork is only available for assistant messages with an SDK uuid (which
	// the SDK requires for `upToMessageId`). Skip the button otherwise so
	// users don't click into a guaranteed-error path.
	const sdkUuid = (sdk as { uuid?: unknown }).uuid;
	const canFork =
		!!onFork && typeof sdkUuid === "string" && sdkUuid.length > 0;
	return (
		<div
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				position: "relative",
				display: "flex",
				gap: 14,
				marginBottom: 22,
				maxWidth: 760,
				marginLeft: "auto",
				marginRight: "auto",
			}}
		>
			<Avatar />
			<div
				style={{
					flex: 1,
					minWidth: 0,
					fontSize: 14,
					color: T.text,
					lineHeight: 1.6,
				}}
			>
				{blocks.map((b, i) => {
					if (b.type === "text") {
						return <MarkdownText key={i} text={b.text ?? ""} />;
					}
					if (b.type === "tool_use") {
						return <ToolUsePill key={i} block={b} />;
					}
					return <RawBlock key={i} block={b} />;
				})}
			</div>
			{canFork && hovered ? (
				<ForkButton
					pending={!!forkPending}
					onClick={() => onFork?.(messageId)}
				/>
			) : null}
		</div>
	);
}

function ForkButton({
	pending,
	onClick,
}: {
	pending: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				if (pending) return;
				onClick();
			}}
			disabled={pending}
			title={
				pending
					? "Forking…"
					: "Fork conversation from this message into a new session"
			}
			aria-label="Fork conversation from this message"
			style={{
				position: "absolute",
				top: 2,
				right: 2,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 22,
				height: 22,
				padding: 0,
				borderRadius: 5,
				border: "none",
				background: "transparent",
				color: pending ? T.textMute : T.textFaint,
				cursor: pending ? "default" : "pointer",
			}}
			onMouseEnter={(e) => {
				if (pending) return;
				e.currentTarget.style.background = T.surfaceHi;
				e.currentTarget.style.color = T.text;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
				e.currentTarget.style.color = pending ? T.textMute : T.textFaint;
			}}
		>
			{/* Branching/fork icon: a trunk that splits into two diverging paths. */}
			<svg width="13" height="13" viewBox="0 0 12 12" fill="none">
				<path
					d="M3 1.5v3.5c0 1 .8 1.8 1.8 1.8h2.4c1 0 1.8.8 1.8 1.8V10.5M3 10.5V7M9 4.5V1.5"
					stroke="currentColor"
					strokeWidth="1.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<circle cx="3" cy="10.5" r="1" fill="currentColor" />
				<circle cx="3" cy="1.5" r="1" fill="currentColor" />
				<circle cx="9" cy="1.5" r="1" fill="currentColor" />
			</svg>
		</button>
	);
}

function UserMessage({ sdk }: { sdk: SdkLike }) {
	const blocks = (sdk.message?.content as ContentBlock[] | undefined) ?? [];
	const isToolResult = blocks.length > 0 && blocks[0].type === "tool_result";

	if (isToolResult) {
		return (
			<div
				style={{
					display: "flex",
					gap: 14,
					marginBottom: 14,
					maxWidth: 760,
					marginLeft: "auto",
					marginRight: "auto",
				}}
			>
				<div style={{ width: 28, flexShrink: 0 }} />
				<div style={{ flex: 1, minWidth: 0 }}>
					{blocks.map((b, i) => (
						<ToolResultPill key={i} block={b} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				justifyContent: "flex-end",
				marginBottom: 18,
				maxWidth: 760,
				marginLeft: "auto",
				marginRight: "auto",
			}}
		>
			<div
				style={{
					maxWidth: "78%",
					padding: "12px 16px",
					borderRadius: 14,
					background: T.surface,
					border: `0.5px solid ${T.border}`,
					fontSize: 14,
					color: T.text,
					lineHeight: 1.55,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{blocks.map((b, i) => {
					if (b.type === "text") {
						return (
							<div key={i} style={{ whiteSpace: "pre-wrap" }}>
								{b.text}
							</div>
						);
					}
					if (b.type === "image" && b.source?.data) {
						return (
							<img
								key={i}
								src={`data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`}
								alt=""
								style={{
									maxWidth: 280,
									maxHeight: 280,
									borderRadius: 8,
									border: `0.5px solid ${T.border}`,
									objectFit: "contain",
								}}
							/>
						);
					}
					return <RawBlock key={i} block={b} />;
				})}
			</div>
		</div>
	);
}

function Avatar() {
	return (
		<div
			style={{
				width: 28,
				height: 28,
				borderRadius: 8,
				flexShrink: 0,
				background: T.accentSoft,
				border: `0.5px solid ${T.accentBorder}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: T.accent,
				fontFamily: T.mono,
				fontSize: 13,
				fontWeight: 700,
			}}
		>
			C
		</div>
	);
}

function ToolUsePill({ block }: { block: ContentBlock }) {
	const summary = summarizeToolInput(block);
	return (
		<details
			style={{
				marginBottom: 6,
				borderRadius: 8,
				background: T.surfaceLow,
				border: `0.5px solid ${T.borderSoft}`,
				padding: "8px 12px",
				fontFamily: T.mono,
				fontSize: 12.5,
			}}
		>
			<summary
				style={{
					cursor: "pointer",
					listStyle: "none",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<span
					style={{
						fontSize: 10.5,
						fontWeight: 600,
						padding: "2px 7px",
						borderRadius: 4,
						background: T.surfaceHi,
						color: T.textDim,
						letterSpacing: 0.4,
						textTransform: "uppercase",
						fontFamily: T.sans,
					}}
				>
					{block.name ?? "tool"}
				</span>
				{summary ? (
					<span
						style={{
							color: T.textDim,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							flex: 1,
						}}
					>
						{summary}
					</span>
				) : null}
			</summary>
			<pre
				style={{
					margin: "8px 0 0",
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily: T.mono,
					maxHeight: 320,
					overflow: "auto",
					color: T.textDim,
				}}
			>
				{JSON.stringify(block.input ?? {}, null, 2)}
			</pre>
		</details>
	);
}

function ToolResultPill({ block }: { block: ContentBlock }) {
	const isError = block.is_error === true;
	const text = stringifyToolResult(block.content);
	const truncated = text.length > 240 ? text.slice(0, 240) + "…" : text;
	return (
		<details
			style={{
				marginBottom: 6,
				borderRadius: 8,
				background: isError ? T.dangerSoft : T.surfaceLow,
				border: `0.5px solid ${isError ? T.dangerBorder : T.borderSoft}`,
				padding: "8px 12px",
				fontFamily: T.mono,
				fontSize: 12.5,
			}}
		>
			<summary
				style={{
					cursor: "pointer",
					listStyle: "none",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<span
					style={{
						fontSize: 10.5,
						fontWeight: 600,
						padding: "2px 7px",
						borderRadius: 4,
						background: isError ? T.dangerSoft : T.surfaceHi,
						color: isError ? T.danger : T.textDim,
						letterSpacing: 0.4,
						textTransform: "uppercase",
						fontFamily: T.sans,
					}}
				>
					{isError ? "error" : "result"}
				</span>
				<span
					style={{
						color: T.textDim,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
					}}
				>
					{truncated.replace(/\n/g, " ⏎ ")}
				</span>
			</summary>
			<pre
				style={{
					margin: "8px 0 0",
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily: T.mono,
					maxHeight: 320,
					overflow: "auto",
					color: T.textDim,
				}}
			>
				{text}
			</pre>
		</details>
	);
}

function RawBlock({ block }: { block: ContentBlock }) {
	return (
		<details>
			<summary style={{ fontSize: 12, color: T.textMute, cursor: "pointer" }}>
				{block.type ?? "block"}
			</summary>
			<pre
				style={{
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily: T.mono,
					color: T.textDim,
				}}
			>
				{JSON.stringify(block, null, 2)}
			</pre>
		</details>
	);
}

function summarizeToolInput(block: ContentBlock): string {
	const input = block.input as Record<string, unknown> | undefined;
	if (!input) return "";
	if (typeof input.command === "string") return input.command;
	if (typeof input.file_path === "string") return input.file_path;
	if (typeof input.path === "string") return input.path;
	if (typeof input.url === "string") return input.url;
	const keys = Object.keys(input).slice(0, 3);
	return keys.length ? keys.join(", ") : "";
}

function stringifyToolResult(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in c)
					return String((c as { text: unknown }).text);
				return JSON.stringify(c);
			})
			.join("\n");
	}
	return JSON.stringify(content, null, 2);
}
