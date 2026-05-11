import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Lifted to module scope so the plugin arrays aren't reallocated on every
// render (which would defeat any memoization downstream in react-markdown).
// rehype-highlight defaults to lowlight's `common` language set (~37 langs)
// — no need to restrict further.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

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
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
