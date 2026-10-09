import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TranscriptChain {
	present: Set<string>;
	reachable: Set<string>;
}

export type TranscriptChainCache = Map<string, TranscriptChain | null>;

function projectsRoot(): string {
	const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
	return join(configDir || join(homedir(), ".claude"), "projects");
}

export async function findTranscriptFile(
	sdkSessionId: string,
): Promise<string | null> {
	if (!sdkSessionId) return null;
	const root = projectsRoot();
	let dirs: string[];
	try {
		dirs = await readdir(root);
	} catch {
		return null;
	}
	for (const d of dirs) {
		const candidate = join(root, d, `${sdkSessionId}.jsonl`);
		try {
			const s = await stat(candidate);
			if (s.isFile()) return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

interface ChainLink {
	uuid: string;
	parentUuid: string | null;
	isSidechain: boolean;
}

function parseChainLink(line: string): ChainLink | null {
	if (!line) return null;
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof entry !== "object" || entry === null) return null;
	const { uuid, parentUuid, isSidechain } = entry as Record<string, unknown>;
	if (typeof uuid !== "string" || uuid.length === 0) return null;
	return {
		uuid,
		parentUuid: typeof parentUuid === "string" ? parentUuid : null,
		isSidechain: isSidechain === true,
	};
}

export function parseTranscriptChain(text: string): TranscriptChain {
	const parentOf = new Map<string, string | null>();
	let leaf: string | null = null;
	for (const line of text.split("\n")) {
		const link = parseChainLink(line);
		if (!link) continue;
		parentOf.set(link.uuid, link.parentUuid);
		if (!link.isSidechain) leaf = link.uuid;
	}
	const reachable = new Set<string>();
	for (
		let cur = leaf;
		cur !== null && !reachable.has(cur);
		cur = parentOf.get(cur) ?? null
	) {
		reachable.add(cur);
	}
	return { present: new Set(parentOf.keys()), reachable };
}

export async function readTranscriptChain(
	sdkSessionId: string,
): Promise<TranscriptChain | null> {
	const file = await findTranscriptFile(sdkSessionId);
	if (!file) return null;
	try {
		return parseTranscriptChain(await readFile(file, "utf8"));
	} catch {
		return null;
	}
}

async function cachedChain(
	sdkSessionId: string,
	cache?: TranscriptChainCache,
): Promise<TranscriptChain | null> {
	if (cache?.has(sdkSessionId)) return cache.get(sdkSessionId) ?? null;
	const chain = await readTranscriptChain(sdkSessionId);
	cache?.set(sdkSessionId, chain);
	return chain;
}

export async function transcriptCanResumeAt(
	sdkSessionId: string,
	uuid: string,
	cache?: TranscriptChainCache,
): Promise<boolean | null> {
	if (!uuid) return null;
	const chain = await cachedChain(sdkSessionId, cache);
	if (chain === null) return null;
	return chain.reachable.has(uuid);
}

const UUID_WAIT_TIMEOUT_MS = 1000;
const UUID_POLL_INTERVAL_MS = 200;

export async function waitForResumableUuid(
	sdkSessionId: string,
	uuid: string,
	timeoutMs = UUID_WAIT_TIMEOUT_MS,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const chain = await readTranscriptChain(sdkSessionId);
		if (chain === null) return true;
		if (chain.reachable.has(uuid)) return true;
		if (chain.present.has(uuid)) return false;
		if (Date.now() >= deadline) return false;
		await new Promise((r) => setTimeout(r, UUID_POLL_INTERVAL_MS));
	}
}
