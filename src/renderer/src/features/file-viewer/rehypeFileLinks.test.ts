import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { FILE_REF_ATTR, rehypeFileLinks } from "./rehypeFileLinks";

function paragraph(...children: Element["children"]): Root {
	return { type: "root", children: [{ type: "element", tagName: "p", properties: {}, children }] };
}

function run(tree: Root): Element["children"] {
	rehypeFileLinks()(tree);
	return (tree.children[0] as Element).children;
}

describe("rehypeFileLinks", () => {
	it("links paths in plain text and keeps trailing punctuation outside", () => {
		const out = run(paragraph({ type: "text", value: "See src/main/index.ts:42. Then /tmp/x.log, done" }));
		expect(out).toHaveLength(5);
		expect(out[0]).toEqual({ type: "text", value: "See " });
		expect((out[1] as Element).properties[FILE_REF_ATTR]).toBe("src/main/index.ts:42");
		expect(out[2]).toEqual({ type: "text", value: ". Then " });
		expect((out[3] as Element).properties[FILE_REF_ATTR]).toBe("/tmp/x.log");
		expect(out[4]).toEqual({ type: "text", value: ", done" });
	});

	it("leaves URLs and ordinary slashes alone", () => {
		const text = "Visit https://example.com/a/b.ts and pick and/or";
		const out = run(paragraph({ type: "text", value: text }));
		expect(out).toEqual([{ type: "text", value: text }]);
	});

	it("wraps inline code that is a path", () => {
		const code: Element = {
			type: "element",
			tagName: "code",
			properties: {},
			children: [{ type: "text", value: "Foo.tsx:12" }],
		};
		const out = run(paragraph(code));
		expect((out[0] as Element).tagName).toBe("a");
		expect((out[0] as Element).properties[FILE_REF_ATTR]).toBe("Foo.tsx:12");
		expect((out[0] as Element).children[0]).toBe(code);
	});

	it("skips code blocks and existing links", () => {
		const tree: Root = {
			type: "root",
			children: [
				{
					type: "element",
					tagName: "pre",
					properties: {},
					children: [
						{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: "src/a.ts" }] },
					],
				},
				{ type: "element", tagName: "a", properties: { href: "x" }, children: [{ type: "text", value: "src/b.ts" }] },
			],
		};
		const before = JSON.stringify(tree);
		rehypeFileLinks()(tree);
		expect(JSON.stringify(tree)).toBe(before);
	});
});
