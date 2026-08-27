import {
	memo,
	useRef,
	useState,
	type AnchorHTMLAttributes,
	type HTMLAttributes,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { T } from "../../../design/tokens";

// Lifted to module scope so the plugin arrays aren't reallocated on every
// render (which would defeat any memoization downstream in react-markdown).
// rehype-highlight defaults to lowlight's `common` language set (~37 langs)
// — no need to restrict further.
const REMARK_PLUGINS = [remarkGfm];
// User bubbles opt into remark-breaks (see the `breaks` prop below) so a
// single Shift+Enter newline still renders as a hard line break instead of
// collapsing into a space the way standard markdown treats soft breaks —
// preserving how multi-line messages have always looked, on top of now
// also rendering markdown. Assistant/plan/notes markdown keeps standard
// soft-break behavior via REMARK_PLUGINS above.
const REMARK_PLUGINS_BREAKS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

// Custom <pre> renderer: wraps the syntax-highlighted block in a relative
// container and overlays a copy button. The button:
//   - is offset from the right edge by 36px to leave a clean gutter for the
//     row-level "•••" actions menu that lives at right:2 of the message row,
//   - fades in on hover of the wrapper, then flips to a check + "Copied!"
//     state for ~1.2 s after a successful clipboard write,
//   - reads the inner text via ref so we copy the raw source (rehype-highlight
//     injects <span>s for tokens; React children would be a tree of those).
function CodeBlock({
	children,
	...preProps
}: HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
	// `node` is a hast node react-markdown passes through; strip it so it
	// doesn't end up on the DOM as an unknown attribute.
	const { node: _node, ...rest } = preProps as HTMLAttributes<HTMLPreElement> & {
		node?: unknown;
	};
	void _node;
	const preRef = useRef<HTMLPreElement | null>(null);
	const [hovered, setHovered] = useState(false);
	const [copied, setCopied] = useState(false);

	const onCopy = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const text = preRef.current?.textContent ?? "";
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// noop — clipboard write can fail in some contexts
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	const showButton = hovered || copied;

	return (
		<div
			style={{ position: "relative" }}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<pre ref={preRef} {...rest}>
				{children}
			</pre>
			<button
				type="button"
				onClick={onCopy}
				aria-label={copied ? "Copied!" : "Copy code"}
				style={{
					position: "absolute",
					// Top-right of the code block with symmetric 8px insets on both
					// axes so the gutter looks even. The row-level "•••" menu now
					// lives under the avatar (left side of the row), so there is no
					// collision to design around here.
					top: 8,
					right: 8,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					padding: 0,
					borderRadius: 5,
					border: "none",
					background: "transparent",
					color: copied ? T.ok : T.textDim,
					cursor: "pointer",
					opacity: showButton ? 1 : 0,
					pointerEvents: showButton ? "auto" : "none",
					transition: "opacity 0.12s, color 0.12s",
				}}
				onMouseEnter={(e) => {
					if (copied) return;
					e.currentTarget.style.color = T.text;
				}}
				onMouseLeave={(e) => {
					if (copied) return;
					e.currentTarget.style.color = T.textDim;
				}}
			>
				{copied ? (
					// Check icon — confirms the copy succeeded.
					<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
						<path
							d="M3 8.5L6.5 12L13 4.5"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				) : (
					// Two-rectangle copy/duplicate icon.
					<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
						<rect
							x="5"
							y="5"
							width="9"
							height="9"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.4"
						/>
						<path
							d="M3 11V3.5C3 2.67 3.67 2 4.5 2H11"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				)}
			</button>
		</div>
	);
}

// Custom anchor: force every link out to the OS default browser. The default
// react-markdown <a> has no target/rel, so a click navigates the renderer
// away from our app (and gets swallowed by Electron). Marking links as
// target="_blank" routes them through Electron's window-open path, which is
// intercepted in main/index.ts (setWindowOpenHandler) and handed to
// shell.openExternal — i.e. to Chrome via the OS default-browser handler.
// Same component instance every render so memoization stays effective.
const COMPONENTS = {
	a: ({
		href,
		children,
		...rest
	}: AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a {...rest} href={href} target="_blank" rel="noreferrer noopener">
			{children}
		</a>
	),
	pre: CodeBlock,
};

// memo wraps the component so a stable `text` prop short-circuits
// re-renders. Combined with messages being immutable in the Zustand store,
// this means already-rendered markdown blocks won't re-parse on parent
// re-renders.
export const MarkdownText = memo(function MarkdownText({
	text,
	breaks,
}: {
	text: string;
	/** Render single newlines as hard breaks (see REMARK_PLUGINS_BREAKS above).
	 * Used for user bubbles; defaults to off so existing callers (assistant
	 * messages, plan approval, notes) render exactly as before. */
	breaks?: boolean;
}) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={breaks ? REMARK_PLUGINS_BREAKS : REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={COMPONENTS}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
