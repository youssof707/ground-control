import { useState } from "react";
import { T } from "../../../design/tokens";
import { copyImageToClipboard } from "../lib/imageActions";

/**
 * Hover-revealed "copy image" affordance overlaid on an image, mirroring the
 * copy button on code blocks in MarkdownText.tsx: fades in with the parent's
 * hover, then flips to a check for ~1.2 s after a successful write.
 *
 * The parent owns the hover state (it's the element with the mouse handlers
 * and `position: relative`), because both callsites already have a wrapper
 * for other reasons — the composer for its remove button, the transcript for
 * this overlay.
 *
 * `corner` exists because the composer thumbnail already has its "×" remove
 * button pinned to the top-right; there the copy button goes top-left so the
 * two don't sit on top of each other.
 */
export function CopyImageButton({
	mediaType,
	data,
	hovered,
	corner = "right",
	size = 24,
	inset = 8,
}: {
	mediaType: string | undefined;
	data: string;
	hovered: boolean;
	corner?: "left" | "right";
	size?: number;
	inset?: number;
}) {
	const [copied, setCopied] = useState(false);

	const onCopy = async (e: React.MouseEvent) => {
		e.preventDefault();
		// The composer thumbnail sits inside the click target of the textarea
		// wrapper, and the transcript image inside the message row — neither
		// should react to this click.
		e.stopPropagation();
		const message = await copyImageToClipboard(mediaType, data);
		if (message) return; // failed; imageActions already logged it
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	const show = hovered || copied;
	const icon = Math.round(size * 0.54);

	return (
		<button
			type="button"
			onClick={onCopy}
			aria-label={copied ? "Copied!" : "Copy image"}
			style={{
				position: "absolute",
				top: inset,
				[corner]: inset,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				padding: 0,
				borderRadius: 5,
				border: "none",
				// Unlike the code-block button, this sits on top of arbitrary
				// image pixels, so it needs its own scrim to stay legible.
				background: copied ? T.surfaceHi : "rgba(0,0,0,0.55)",
				color: copied ? T.ok : "#fff",
				cursor: "pointer",
				opacity: show ? 1 : 0,
				pointerEvents: show ? "auto" : "none",
				transition: "opacity 0.12s, color 0.12s, background 0.12s",
			}}
		>
			{copied ? (
				// Check icon — confirms the copy succeeded.
				<svg width={icon} height={icon} viewBox="0 0 16 16" fill="none">
					<path
						d="M3 8.5L6.5 12L13 4.5"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				// Two-rectangle copy/duplicate icon — same glyph as code blocks.
				<svg width={icon} height={icon} viewBox="0 0 16 16" fill="none">
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
	);
}
