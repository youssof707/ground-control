import { structuredPatch, type StructuredPatchHunk } from "diff";

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
					<span className="diff-content">{r.content || " "}</span>
				</div>
			))}
		</div>
	);
}

function ensureNewline(s: string): string {
	return s.endsWith("\n") ? s : s + "\n";
}
