const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const ESCAPE_SEQUENCES = new RegExp(
	[
		`${ESC}\\[[0-?]*[ -/]*[@-~]`,
		`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
		`${ESC}[()][0-9A-Za-z]`,
		`${ESC}[@-Z\\\\^_=>]`,
	].join("|"),
	"g",
);

const MAX_PENDING_CHARS = 4000;
const MAX_LINE_CHARS = 200;

function isPrintable(char: string): boolean {
	const code = char.charCodeAt(0);
	return char === "\r" || char === "\n" || (code >= 32 && code !== 127);
}

function stripControl(text: string): string {
	return Array.from(text.replace(ESCAPE_SEQUENCES, ""))
		.filter(isPrintable)
		.join("");
}

function visibleText(rawLine: string): string {
	const withoutTrailingReturn = rawLine.replace(/\r+$/, "");
	return withoutTrailingReturn
		.slice(withoutTrailingReturn.lastIndexOf("\r") + 1)
		.trim();
}

export class LastLineTracker {
	private pending = "";
	private line = "";
	private current = "";
	private prompt = "";
	private awaitingPrompt = true;
	private includeTail = false;

	get value(): string {
		return this.current;
	}

	push(chunk: string): boolean {
		const segments = (this.pending + stripControl(chunk)).split("\n");
		this.pending = (segments.pop() ?? "").slice(-MAX_PENDING_CHARS);
		for (const segment of segments) {
			const visible = visibleText(segment);
			if (visible && !this.isPromptLine(visible)) this.line = visible;
		}
		return this.refresh();
	}

	input(data: string): void {
		if (this.awaitingPrompt && !this.includeTail) {
			const tail = visibleText(this.pending);
			if (tail) {
				this.prompt = tail;
				this.awaitingPrompt = false;
			}
		}
		if (data.includes("\r")) this.awaitingPrompt = true;
	}

	setForegroundRunning(running: boolean): boolean {
		this.includeTail = running;
		return this.refresh();
	}

	private isPromptLine(text: string): boolean {
		return this.prompt !== "" && text.startsWith(this.prompt);
	}

	private refresh(): boolean {
		const before = this.current;
		const tail = this.includeTail ? visibleText(this.pending) : "";
		const next = tail && !this.isPromptLine(tail) ? tail : this.line;
		this.current = next.slice(0, MAX_LINE_CHARS);
		return this.current !== before;
	}
}
