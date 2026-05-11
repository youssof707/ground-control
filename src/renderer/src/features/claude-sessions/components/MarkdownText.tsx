import { memo, type AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Lifted to module scope so the plugin arrays aren't reallocated on every
// render (which would defeat any memoization downstream in react-markdown).
// rehype-highlight defaults to lowlight's `common` language set (~37 langs)
// — no need to restrict further.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

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
};

// memo wraps the component so a stable `text` prop short-circuits
// re-renders. Combined with messages being immutable in the Zustand store,
// this means already-rendered markdown blocks won't re-parse on parent
// re-renders.
export const MarkdownText = memo(function MarkdownText({
	text,
}: {
	text: string;
}) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={COMPONENTS}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
