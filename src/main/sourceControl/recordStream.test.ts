import { describe, expect, it } from "vitest";
import { createRecordSplitter } from "./recordStream";

function split(chunks: Buffer[]): string[] {
	const out: string[] = [];
	const splitter = createRecordSplitter((r) => out.push(r.toString("utf8")));
	for (const chunk of chunks) splitter.push(chunk);
	splitter.end();
	return out;
}

function randomCuts(data: Buffer, seed: number): Buffer[] {
	let state = seed;
	const next = (): number => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state;
	};
	const chunks: Buffer[] = [];
	let at = 0;
	while (at < data.length) {
		const size = 1 + (next() % 7);
		chunks.push(data.subarray(at, at + size));
		at += size;
	}
	return chunks;
}

describe("createRecordSplitter", () => {
	it("splits on NUL and keeps the trailing record", () => {
		expect(split([Buffer.from("a\0bb\0ccc")])).toEqual(["a", "bb", "ccc"]);
	});

	it("emits empty records between consecutive NULs", () => {
		expect(split([Buffer.from("a\0\0b\0")])).toEqual(["a", "", "b"]);
	});

	it("gives the same records for any chunking, including mid-character cuts", () => {
		const records = ["? 日本語/ファイル.txt", "1 .M N... x", "", "? café", "# branch.head main"];
		const data = Buffer.from(records.map((r) => `${r}\0`).join(""), "utf8");
		for (let seed = 1; seed <= 200; seed++) {
			expect(split(randomCuts(data, seed))).toEqual(records);
		}
	});

	it("does not keep a reference to the incoming chunk for leftovers", () => {
		const chunk = Buffer.from("abc\0de");
		const out: string[] = [];
		const splitter = createRecordSplitter((r) => out.push(r.toString()));
		splitter.push(chunk);
		chunk.fill(0x7a);
		splitter.push(Buffer.from("f\0"));
		expect(out).toEqual(["abc", "def"]);
	});
});
