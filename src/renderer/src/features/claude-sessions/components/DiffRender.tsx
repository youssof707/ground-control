import {
	parsePatch,
	structuredPatch,
	type StructuredPatchHunk,
} from "diff";

export type FileType = "add" | "delete" | "modify" | "rename" | "copy";

interface RenderedFile {
	type: FileType;
	path: string;
	hunks: StructuredPatchHunk[];
}

export function DiffPage({ diffText }: { diffText: string }) {
	const files = parseUnified(diffText);
	if (files.length === 0) {
		return <div className="diff-empty">No textual difference.</div>;
	}
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{files.map((f, i) => (
				<DiffFile key={`${f.path}-${i}`} file={f} />
			))}
		</div>
	);
}

export function InlineDiff({
	oldText,
	newText,
	fileName,
}: {
	oldText: string;
	newText: string;
	fileName: string;
}) {
	const name = fileName || "file";
	const patch = structuredPatch(
		name,
		name,
		ensureNewline(oldText),
		ensureNewline(newText),
		"",
		"",
		{ context: 3 },
	);
	if (patch.hunks.length === 0) {
		return <div className="diff-empty">No textual difference.</div>;
	}
	return (
		<div className="diff-file">
			<div className="diff-body">
				{patch.hunks.map((h, i) => (
					<HunkBlock key={i} hunk={h} />
				))}
			</div>
		</div>
	);
}

function DiffFile({ file }: { file: RenderedFile }) {
	const labels: Record<FileType, string> = {
		add: "ADDED",
		delete: "DELETED",
		modify: "MODIFIED",
		rename: "RENAMED",
		copy: "COPIED",
	};
	return (
		<section className="diff-file">
			<header className="diff-file-header">
				<span className={`diff-file-badge ${file.type}`}>
					{labels[file.type]}
				</span>
				<span>{file.path}</span>
			</header>
			<div className="diff-body">
				{file.hunks.length === 0 ? (
					<div className="diff-empty">Binary or no textual changes.</div>
				) : (
					file.hunks.map((h, i) => <HunkBlock key={i} hunk={h} />)
				)}
			</div>
		</section>
	);
}

function HunkBlock({ hunk }: { hunk: StructuredPatchHunk }) {
	let oldLine = hunk.oldStart;
	let newLine = hunk.newStart;
	const rows: { kind: "add" | "del" | "ctx"; oldNum: string; newNum: string; content: string }[] = [];

	for (const raw of hunk.lines) {
		const sign = raw.charAt(0);
		const content = raw.slice(1);
		if (sign === "+") {
			rows.push({
				kind: "add",
				oldNum: "",
				newNum: String(newLine++),
				content,
			});
		} else if (sign === "-") {
			rows.push({
				kind: "del",
				oldNum: String(oldLine++),
				newNum: "",
				content,
			});
		} else if (sign === "\\") {
			// "\ No newline at end of file" — render as a comment-like context row
			rows.push({ kind: "ctx", oldNum: "", newNum: "", content: raw });
		} else {
			rows.push({
				kind: "ctx",
				oldNum: String(oldLine++),
				newNum: String(newLine++),
				content,
			});
		}
	}

	return (
		<div>
			<div className="diff-hunk-header">
				@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
			</div>
			{rows.map((r, i) => (
				<div key={i} className={`diff-line ${r.kind}`}>
					<span className="diff-num">{r.oldNum}</span>
					<span className="diff-num">{r.newNum}</span>
					<span className="diff-sign">
						{r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}
					</span>
					<span className="diff-content">{r.content || " "}</span>
				</div>
			))}
		</div>
	);
}

function parseUnified(diffText: string): RenderedFile[] {
	const parsed = parsePatch(diffText);
	const out: RenderedFile[] = [];
	for (const p of parsed) {
		const oldName = p.oldFileName ?? "";
		const newName = p.newFileName ?? "";
		const oldStripped = stripPrefix(oldName);
		const newStripped = stripPrefix(newName);
		const path = newStripped !== "/dev/null" ? newStripped : oldStripped;
		let type: FileType = "modify";
		if (oldStripped === "/dev/null") type = "add";
		else if (newStripped === "/dev/null") type = "delete";
		else if (oldStripped !== newStripped) type = "rename";
		out.push({ type, path, hunks: p.hunks ?? [] });
	}
	return out;
}

function stripPrefix(name: string): string {
	if (name.startsWith("a/")) return name.slice(2);
	if (name.startsWith("b/")) return name.slice(2);
	return name;
}

function ensureNewline(s: string): string {
	return s.endsWith("\n") ? s : s + "\n";
}
