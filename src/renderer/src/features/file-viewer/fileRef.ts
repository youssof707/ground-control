export interface FileRef {
	path: string;
	line?: number;
	endLine?: number;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HASH_LINE = /#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/;
const COLON_LINE = /:(\d+)(?:(?::\d+)|(?:-(\d+)))?$/;
const PAREN_LINE = /\((\d+)(?:,\d+)?\)$/;
const BARE_NAME = /^[\w@+-][\w.@+-]*\.[A-Za-z][\w-]{0,15}$/;
const SEGMENT = /^[\w.@+~ ()[\],'-]*$/;

function lineNumber(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const n = Number(text);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

function stripLine(raw: string): { path: string; line?: number; endLine?: number } {
	for (const pattern of [HASH_LINE, COLON_LINE, PAREN_LINE]) {
		const match = pattern.exec(raw);
		if (!match) continue;
		const line = lineNumber(match[1]);
		if (line === undefined) continue;
		const end = lineNumber(match[2]);
		return {
			path: raw.slice(0, match.index),
			line,
			endLine: end !== undefined && end >= line ? end : undefined,
		};
	}
	return { path: raw };
}

function decodeFileUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		if (url.host && url.host !== "localhost") return null;
		return decodeURIComponent(url.pathname) + url.hash;
	} catch {
		return null;
	}
}

export function parseFileRef(input: string, options: { allowSpaces?: boolean } = {}): FileRef | null {
	let raw = input.trim();
	if (!raw || raw.length > 1024) return null;
	if (options.allowSpaces ? /[\t\n\r]/.test(raw) : /\s/.test(raw)) return null;
	if (/^file:\/\//i.test(raw)) {
		const decoded = decodeFileUrl(raw);
		if (!decoded) return null;
		raw = decoded;
	} else if (SCHEME.test(raw) && !/^[^/]+\.[A-Za-z][\w-]*:\d/.test(raw)) {
		return null;
	}
	const { path, line, endLine } = stripLine(raw);
	if (!path || path === "/") return null;
	const hasSlash = path.includes("/");
	if (!hasSlash) {
		if (line === undefined || !BARE_NAME.test(path)) return null;
	} else {
		if (path.startsWith("//") || path.includes("://")) return null;
		const segments = path.split("/");
		if (!segments.every((s) => SEGMENT.test(s))) return null;
		const last = segments[segments.length - 1] ?? "";
		const anchored = /^(\/|~\/|\.\.?\/)/.test(path);
		if (!anchored && !/\.[A-Za-z][\w-]{0,15}$/.test(last) && line === undefined) return null;
		if (!anchored && segments.some((s) => s === "")) return null;
	}
	const ref: FileRef = { path };
	if (line !== undefined) ref.line = line;
	if (endLine !== undefined) ref.endLine = endLine;
	return ref;
}

export function formatFileRef(ref: FileRef): string {
	if (ref.line === undefined) return ref.path;
	if (ref.endLine !== undefined && ref.endLine !== ref.line) return `${ref.path}:${ref.line}-${ref.endLine}`;
	return `${ref.path}:${ref.line}`;
}
