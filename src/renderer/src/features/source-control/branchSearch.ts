import type { ScmBranch } from "@shared/schemas/source_control";

export interface IndexedBranch {
	branch: ScmBranch;
	lower: string;
	leafStart: number;
	order: number;
}

export interface BranchMatches {
	items: IndexedBranch[];
	total: number;
}

const BOUNDARY = new Set(["/", "-", "_", ".", " "]);

export function indexBranches(branches: readonly ScmBranch[], current: string | null): IndexedBranch[] {
	const local: ScmBranch[] = [];
	const remote: ScmBranch[] = [];
	let head: ScmBranch | null = null;
	for (const branch of branches) {
		if (!branch.remote && branch.name === current) head = branch;
		else (branch.remote ? remote : local).push(branch);
	}
	const ordered = head ? [head, ...local, ...remote] : [...local, ...remote];
	return ordered.map((branch, order) => {
		const lower = branch.name.toLowerCase();
		return { branch, lower, leafStart: lower.lastIndexOf("/") + 1, order };
	});
}

function tokenScore(entry: IndexedBranch, token: string): number {
	const { lower, leafStart } = entry;
	const at = lower.indexOf(token);
	if (at !== -1) {
		let score = 1000 - Math.min(at, 200);
		if (at === 0 || at === leafStart) score += 400;
		else if (BOUNDARY.has(lower[at - 1])) score += 200;
		if (lower.length === token.length || lower.length - leafStart === token.length) score += 300;
		return score;
	}
	let cursor = 0;
	let gaps = 0;
	let last = -1;
	for (let i = 0; i < token.length; i++) {
		const found = lower.indexOf(token[i], cursor);
		if (found === -1) return -1;
		if (last !== -1 && found !== last + 1) gaps++;
		last = found;
		cursor = found + 1;
	}
	return Math.max(1, 300 - gaps * 25 - Math.min(lower.length, 100));
}

export function searchBranches(index: readonly IndexedBranch[], query: string, limit: number): BranchMatches {
	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { items: index.slice(0, limit), total: index.length };
	const scored: Array<{ entry: IndexedBranch; score: number }> = [];
	for (const entry of index) {
		let score = 0;
		for (const token of tokens) {
			const part = tokenScore(entry, token);
			if (part < 0) {
				score = -1;
				break;
			}
			score += part;
		}
		if (score < 0) continue;
		if (!entry.branch.remote) score += 50;
		scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
	const items = new Array<IndexedBranch>(Math.min(limit, scored.length));
	for (let i = 0; i < items.length; i++) items[i] = scored[i].entry;
	return { items, total: scored.length };
}
