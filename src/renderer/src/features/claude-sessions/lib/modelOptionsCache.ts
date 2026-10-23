import { create } from "zustand";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { parseOptionIdentity } from "@shared/claude-sessions/sessionModel";

export interface ModelOption {
	value: string | undefined;
	displayName: string;
	description?: string;
}

function firstSegment(description: string | undefined): string | undefined {
	if (!description) return undefined;
	const idx = description.indexOf(" · ");
	const head = (idx === -1 ? description : description.slice(0, idx)).trim();
	return head.length > 0 ? head : undefined;
}

function dedupeLatest(options: ModelOption[]): ModelOption[] {
	const result: ModelOption[] = [];
	const slotByFamily = new Map<string, number>();
	for (const o of options) {
		const id =
			o.value === "default"
				? null
				: parseOptionIdentity(o.value, o.description, o.displayName);
		if (!id || id.major === undefined) {
			result.push(o);
			continue;
		}
		const key = `${id.family}${id.oneM ? "[1m]" : ""}`;
		const slot = slotByFamily.get(key);
		if (slot === undefined) {
			slotByFamily.set(key, result.length);
			result.push(o);
			continue;
		}
		const incumbent = result[slot];
		const incumbentId = parseOptionIdentity(
			incumbent.value,
			incumbent.description,
			incumbent.displayName,
		);
		const better =
			incumbentId?.major === undefined ||
			id.major > incumbentId.major ||
			(id.major === incumbentId.major &&
				(id.minor ?? -1) > (incumbentId.minor ?? -1));
		if (better) result[slot] = o;
	}
	return result;
}

function toOptions(list: ModelInfo[] | null | undefined): ModelOption[] {
	return dedupeLatest(
		(list ?? []).map((m) => ({
			value: m.value,
			displayName: m.displayName,
			description: firstSegment(m.description),
		})),
	);
}

interface State {
	options: ModelOption[] | null;
	error: string | null;
	loading: boolean;
}

export const useModelOptionsStore = create<State>(() => ({
	options: null,
	error: null,
	loading: false,
}));

let inFlight: Promise<void> | null = null;

function describeError(err: unknown): string {
	return err instanceof Error && err.message
		? `Couldn't list models: ${err.message}`
		: "Couldn't reach the Claude CLI to list models. Try again.";
}

export function refreshModelOptions(sessionId?: string): Promise<void> {
	if (inFlight) return inFlight;
	useModelOptionsStore.setState({ loading: true, error: null });
	inFlight = (async () => {
		try {
			const list = await window.claude.getSupportedModels(sessionId);
			useModelOptionsStore.setState({ options: toOptions(list), error: null });
		} catch (err) {
			console.error("[ccw] getSupportedModels failed:", err);
			if (useModelOptionsStore.getState().options === null) {
				useModelOptionsStore.setState({ error: describeError(err) });
			}
		} finally {
			useModelOptionsStore.setState({ loading: false });
			inFlight = null;
		}
	})();
	return inFlight;
}

export function assignModelHotkeys(titles: string[]): (string | null)[] {
	const taken = new Set<string>();
	return titles.map((title) => {
		for (const ch of title.toLowerCase()) {
			if (ch < "a" || ch > "z" || taken.has(ch)) continue;
			taken.add(ch);
			return ch;
		}
		return null;
	});
}
