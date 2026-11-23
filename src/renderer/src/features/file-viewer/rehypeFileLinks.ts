import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import { parseFileRef } from "./fileRef";

export const FILE_REF_ATTR = "dataFileRef";

const CANDIDATE =
	/(?<![\w/:.@~-])(?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+)+\/?(?::\d+(?:[-:]\d+)?|#L\d+(?:-L?\d+)?)?/g;
const TRAILING = /[.,;:!?)\]'"]+$/;
const SKIP = new Set(["a", "pre", "code", "script", "style"]);

function textOf(node: Element): string | null {
	if (node.children.length !== 1) return null;
	const only = node.children[0];
	return only?.type === "text" ? only.value : null;
}

function fileLink(raw: string, children: ElementContent[]): Element {
	return {
		type: "element",
		tagName: "a",
		properties: { [FILE_REF_ATTR]: raw },
		children,
	};
}

function splitText(node: Text): ElementContent[] | null {
	const value = node.value;
	if (!value.includes("/")) return null;
	const out: ElementContent[] = [];
	let last = 0;
	CANDIDATE.lastIndex = 0;
	for (let match = CANDIDATE.exec(value); match; match = CANDIDATE.exec(value)) {
		const raw = match[0].replace(TRAILING, "");
		if (!raw || !parseFileRef(raw)) continue;
		const start = match.index;
		if (start > last) out.push({ type: "text", value: value.slice(last, start) });
		out.push(fileLink(raw, [{ type: "text", value: raw }]));
		last = start + raw.length;
		CANDIDATE.lastIndex = last;
	}
	if (out.length === 0) return null;
	if (last < value.length) out.push({ type: "text", value: value.slice(last) });
	return out;
}

function walk(parent: Root | Element): void {
	const next: RootContent[] = [];
	let changed = false;
	for (const child of parent.children) {
		if (child.type === "text") {
			const parts = splitText(child);
			if (parts) {
				next.push(...parts);
				changed = true;
				continue;
			}
		} else if (child.type === "element") {
			if (child.tagName === "code") {
				const text = textOf(child);
				if (text !== null && parseFileRef(text)) {
					next.push(fileLink(text.trim(), [child]));
					changed = true;
					continue;
				}
			} else if (!SKIP.has(child.tagName)) {
				walk(child);
			}
		}
		next.push(child);
	}
	if (changed) parent.children = next as typeof parent.children;
}

export function rehypeFileLinks() {
	return (tree: Root): void => walk(tree);
}
