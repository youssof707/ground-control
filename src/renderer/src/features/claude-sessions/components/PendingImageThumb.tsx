import { useState } from "react";
import type { PendingImage } from "../lib/pendingImage";
import { openImageInPreview } from "../lib/imageActions";
import { CopyImageButton } from "./CopyImageButton";
import { T } from "../../../design/tokens";

/**
 * One pending-paste thumbnail: the image, a hover-revealed copy button, and
 * the always-visible "×" remove button.
 *
 * Owns its own hover state — a single `hoveredIndex` on the parent would
 * re-render every thumbnail on each mouse move between them.
 */
export function PendingImageThumb({
	img,
	onRemove,
	onError,
	size = 64,
}: {
	img: PendingImage;
	onRemove: () => void;
	onError: (message: string | null) => void;
	/** Edge length in px. The sidequest panel uses a smaller thumb because it
	 * can be as narrow as 280px. */
	size?: number;
}) {
	const [hovered, setHovered] = useState(false);
	return (
		<div
			style={{ position: "relative" }}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<img
				src={img.previewUrl}
				alt=""
				// `img.data` (raw base64) rather than `previewUrl` — the handler
				// accepts either, but this skips shipping the redundant data-URL
				// prefix over IPC.
				onDoubleClick={() => {
					void openImageInPreview(img.media_type, img.data).then(
						// null on success, which also clears any stale error from
						// a previous failed attempt.
						onError,
					);
				}}
				style={{
					display: "block",
					height: size,
					width: size,
					objectFit: "cover",
					borderRadius: 6,
					border: `0.5px solid ${T.border}`,
					// Suppress the selection flash a double-click otherwise
					// paints over the thumbnail.
					userSelect: "none",
				}}
			/>
			{/* Top-left: the "×" already owns the top-right corner. Sized down
			    so it doesn't swamp the thumbnail. */}
			<CopyImageButton
				mediaType={img.media_type}
				data={img.data}
				hovered={hovered}
				corner="left"
				size={20}
				inset={4}
			/>
			<button
				onClick={onRemove}
				aria-label="Remove"
				style={{
					position: "absolute",
					top: -6,
					right: -6,
					width: 20,
					height: 20,
					borderRadius: "50%",
					border: "none",
					background: T.text,
					color: T.bg,
					fontSize: 12,
					cursor: "pointer",
					lineHeight: 1,
				}}
			>
				×
			</button>
		</div>
	);
}

/**
 * The wrapping row of pending-paste thumbnails above a composer's textarea.
 * Renders nothing when the draft has no images.
 */
export function PendingImageStrip({
	images,
	onRemove,
	onError,
	size,
}: {
	images: PendingImage[];
	onRemove: (idx: number) => void;
	onError: (message: string | null) => void;
	size?: number;
}) {
	if (images.length === 0) return null;
	return (
		<div
			style={{
				display: "flex",
				gap: 6,
				flexWrap: "wrap",
				marginBottom: 10,
			}}
		>
			{images.map((img, i) => (
				<PendingImageThumb
					key={i}
					img={img}
					size={size}
					onRemove={() => onRemove(i)}
					onError={onError}
				/>
			))}
		</div>
	);
}
