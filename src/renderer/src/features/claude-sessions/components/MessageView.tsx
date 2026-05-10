import type { SessionMessage } from "@shared/claude-sessions/types";
import { MarkdownText } from "./MarkdownText";

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

export function MessageView({ m }: { m: SessionMessage }) {
	const sdk = m.content as SdkLike;
	if (m.role === "assistant") return <AssistantMessage sdk={sdk} />;
	if (m.role === "user") return <UserMessage sdk={sdk} />;
	if (m.role === "system") return <SystemNote text="session initialized" />;
	return <ResultNote sdk={sdk} />;
}

function AssistantMessage({ sdk }: { sdk: SdkLike }) {
	const blocks = (sdk.message?.content as ContentBlock[] | undefined) ?? [];
	return (
		<div style={{ maxWidth: 760 }}>
			<RoleLabel>Claude</RoleLabel>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{blocks.map((b, i) => {
					if (b.type === "text") {
						return <MarkdownText key={i} text={b.text ?? ""} />;
					}
					if (b.type === "tool_use") {
						return <ToolUseCard key={i} block={b} />;
					}
					return <RawBlock key={i} block={b} />;
				})}
			</div>
		</div>
	);
}

function UserMessage({ sdk }: { sdk: SdkLike }) {
	const blocks = (sdk.message?.content as ContentBlock[] | undefined) ?? [];
	const isToolResult = blocks.length > 0 && blocks[0].type === "tool_result";

	if (isToolResult) {
		return (
			<div style={{ maxWidth: 760 }}>
				{blocks.map((b, i) => (
					<ToolResultCard key={i} block={b} />
				))}
			</div>
		);
	}

	return (
		<div style={{ display: "flex", justifyContent: "flex-end" }}>
			<div
				style={{
					maxWidth: 760,
					background: "#e8f0fe",
					border: "1px solid #cfe0ff",
					borderRadius: 10,
					padding: "8px 12px",
				}}
			>
				<RoleLabel>You</RoleLabel>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
					}}
				>
					{blocks.map((b, i) => {
						if (b.type === "text") {
							return (
								<div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
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
										borderRadius: 6,
										border: "1px solid #cfe0ff",
										objectFit: "contain",
									}}
								/>
							);
						}
						return <RawBlock key={i} block={b} />;
					})}
				</div>
			</div>
		</div>
	);
}

function ToolUseCard({ block }: { block: ContentBlock }) {
	const summary = summarizeToolInput(block);
	return (
		<details
			style={{
				border: "1px solid #e5e5ea",
				borderRadius: 6,
				background: "#fafafa",
				padding: "6px 10px",
				fontSize: 13,
			}}
		>
			<summary style={{ cursor: "pointer", userSelect: "none" }}>
				<span style={{ marginRight: 6 }}>🔧</span>
				<strong>{block.name ?? "tool"}</strong>
				{summary ? (
					<span
						style={{
							marginLeft: 8,
							color: "#6e6e73",
							fontFamily:
								"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
							fontSize: 12,
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
					fontFamily:
						"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
					maxHeight: 320,
					overflow: "auto",
				}}
			>
				{JSON.stringify(block.input ?? {}, null, 2)}
			</pre>
		</details>
	);
}

function ToolResultCard({ block }: { block: ContentBlock }) {
	const isError = block.is_error === true;
	const text = stringifyToolResult(block.content);
	const truncated = text.length > 240 ? text.slice(0, 240) + "…" : text;
	return (
		<details
			style={{
				border: "1px solid",
				borderColor: isError ? "#f5c2c2" : "#e5e5ea",
				borderRadius: 6,
				background: isError ? "#fdecec" : "#fafafa",
				padding: "6px 10px",
				fontSize: 13,
			}}
		>
			<summary style={{ cursor: "pointer", userSelect: "none" }}>
				<span style={{ marginRight: 6 }}>{isError ? "⚠️" : "✓"}</span>
				<span style={{ color: isError ? "#c92a2a" : "#515154" }}>
					tool result
				</span>
				<span
					style={{
						marginLeft: 8,
						color: "#6e6e73",
						fontFamily:
							"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
						fontSize: 12,
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
					fontFamily:
						"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
					maxHeight: 320,
					overflow: "auto",
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
			<summary style={{ fontSize: 12, color: "#86868b", cursor: "pointer" }}>
				{block.type ?? "block"}
			</summary>
			<pre
				style={{
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily:
						"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
				}}
			>
				{JSON.stringify(block, null, 2)}
			</pre>
		</details>
	);
}

function ResultNote({ sdk }: { sdk: SdkLike }) {
	const subtype = sdk.subtype ?? "result";
	return <SystemNote text={`turn ended (${subtype})`} />;
}

function SystemNote({ text }: { text: string }) {
	return (
		<div
			style={{
				fontSize: 11,
				color: "#86868b",
				textAlign: "center",
				fontStyle: "italic",
				padding: "2px 0",
			}}
		>
			{text}
		</div>
	);
}

function RoleLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				fontSize: 11,
				textTransform: "uppercase",
				letterSpacing: "0.04em",
				color: "#86868b",
				marginBottom: 4,
			}}
		>
			{children}
		</div>
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
