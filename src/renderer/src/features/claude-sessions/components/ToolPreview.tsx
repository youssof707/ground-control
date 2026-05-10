import { InlineDiff } from "./DiffRender";
import { T } from "../../../design/tokens";

interface EditInput {
	file_path?: string;
	old_string?: string;
	new_string?: string;
	replace_all?: boolean;
}

interface MultiEditInput {
	file_path?: string;
	edits?: { old_string: string; new_string: string; replace_all?: boolean }[];
}

interface WriteInput {
	file_path?: string;
	content?: string;
}

interface BashInput {
	command?: string;
	description?: string;
	timeout?: number;
	run_in_background?: boolean;
}

interface ReadInput {
	file_path?: string;
	offset?: number;
	limit?: number;
}

interface GrepInput {
	pattern?: string;
	path?: string;
	glob?: string;
	output_mode?: string;
}

interface GlobInput {
	pattern?: string;
	path?: string;
}

const codeBlockStyle: React.CSSProperties = {
	margin: 0,
	padding: "10px 12px",
	background: T.bg,
	color: T.text,
	border: `0.5px solid ${T.border}`,
	borderRadius: 8,
	fontSize: 12.5,
	maxHeight: 320,
	overflow: "auto",
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	fontFamily: T.mono,
};

export function ToolPreview({
	toolName,
	input,
}: {
	toolName: string;
	input: Record<string, unknown>;
}) {
	switch (toolName) {
		case "Edit":
			return <EditPreview input={input as EditInput} />;
		case "MultiEdit":
			return <MultiEditPreview input={input as MultiEditInput} />;
		case "Write":
			return <WritePreview input={input as WriteInput} />;
		case "Bash":
			return <BashPreview input={input as BashInput} />;
		case "Read":
			return <ReadPreview input={input as ReadInput} />;
		case "Grep":
			return <GrepPreview input={input as GrepInput} />;
		case "Glob":
			return <GlobPreview input={input as GlobInput} />;
		default:
			return <DefaultPreview input={input} />;
	}
}

function EditPreview({ input }: { input: EditInput }) {
	const path = input.file_path ?? "";
	return (
		<div>
			<PathRow path={path} suffix={input.replace_all ? "(replace all)" : ""} />
			<InlineDiff
				oldText={input.old_string ?? ""}
				newText={input.new_string ?? ""}
				fileName={path}
			/>
		</div>
	);
}

function MultiEditPreview({ input }: { input: MultiEditInput }) {
	const path = input.file_path ?? "";
	const edits = input.edits ?? [];
	return (
		<div>
			<PathRow
				path={path}
				suffix={`${edits.length} edit${edits.length === 1 ? "" : "s"}`}
			/>
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{edits.map((e, i) => (
					<InlineDiff
						key={i}
						oldText={e.old_string ?? ""}
						newText={e.new_string ?? ""}
						fileName={path}
					/>
				))}
			</div>
		</div>
	);
}

function WritePreview({ input }: { input: WriteInput }) {
	const path = input.file_path ?? "";
	const content = input.content ?? "";
	return (
		<div>
			<PathRow path={path} suffix={`${content.split("\n").length} lines`} />
			<pre style={codeBlockStyle}>{content}</pre>
		</div>
	);
}

function BashPreview({ input }: { input: BashInput }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			{input.description ? (
				<div style={{ fontSize: 13, color: T.textDim }}>
					{input.description}
				</div>
			) : null}
			<pre style={codeBlockStyle}>$ {input.command ?? ""}</pre>
			{input.run_in_background || input.timeout ? (
				<div style={{ fontSize: 11, color: T.textFaint, fontFamily: T.mono }}>
					{input.run_in_background ? "background · " : ""}
					{input.timeout ? `timeout ${input.timeout}ms` : ""}
				</div>
			) : null}
		</div>
	);
}

function ReadPreview({ input }: { input: ReadInput }) {
	const range =
		input.offset != null || input.limit != null
			? ` (lines ${input.offset ?? 1}–${(input.offset ?? 0) + (input.limit ?? 0)})`
			: "";
	return <PathRow path={(input.file_path ?? "") + range} />;
}

function GrepPreview({ input }: { input: GrepInput }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<div style={{ fontSize: 13, fontFamily: T.mono, color: T.text }}>
				/{input.pattern ?? ""}/
			</div>
			<div style={{ fontSize: 12, color: T.textMute, fontFamily: T.mono }}>
				{input.path ?? "(cwd)"}
				{input.glob ? ` · ${input.glob}` : ""}
				{input.output_mode ? ` · mode: ${input.output_mode}` : ""}
			</div>
		</div>
	);
}

function GlobPreview({ input }: { input: GlobInput }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<div style={{ fontSize: 13, fontFamily: T.mono, color: T.text }}>
				{input.pattern ?? ""}
			</div>
			{input.path ? (
				<div style={{ fontSize: 12, color: T.textMute, fontFamily: T.mono }}>
					{input.path}
				</div>
			) : null}
		</div>
	);
}

function DefaultPreview({ input }: { input: Record<string, unknown> }) {
	return <pre style={codeBlockStyle}>{JSON.stringify(input, null, 2)}</pre>;
}

function PathRow({ path, suffix }: { path: string; suffix?: string }) {
	return (
		<div
			style={{
				fontSize: 12,
				fontFamily: T.mono,
				color: T.text,
				marginBottom: 8,
				display: "flex",
				alignItems: "center",
				gap: 8,
				wordBreak: "break-all",
			}}
		>
			<span>{path}</span>
			{suffix ? (
				<span style={{ color: T.textFaint, fontSize: 11 }}>{suffix}</span>
			) : null}
		</div>
	);
}
