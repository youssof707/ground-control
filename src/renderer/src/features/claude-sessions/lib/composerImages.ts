import type {
	UserContentBlock,
	UserImageMediaType,
} from "@shared/claude-sessions/types";
import type { PendingImage } from "./pendingImage";

/**
 * Pure helpers shared by every message composer (the main
 * `ImagePasteTextarea` and the sidequest panel's `SidequestComposer`).
 *
 * These used to live inside `ImagePasteTextarea`, which is why the sidequest
 * composer silently dropped pasted images. Anything about *what* an image
 * draft is — which types we accept, how a draft becomes SDK content blocks —
 * belongs here so a fix lands in both composers at once.
 */

/**
 * What the Anthropic API accepts as an image block. Anything else pasted is
 * rejected with a visible error rather than sent and 400'd.
 */
export const SUPPORTED_IMAGE_TYPES: readonly UserImageMediaType[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

export function toSupportedMediaType(t: string): UserImageMediaType | null {
	return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t)
		? (t as UserImageMediaType)
		: null;
}

/**
 * Stable reference for the "no draft images" selector default. Must be a
 * single module-level frozen array: a fresh `[]` literal in a zustand selector
 * breaks reference equality and re-renders the composer on every unrelated
 * store update.
 */
export const EMPTY_IMAGES: PendingImage[] = Object.freeze(
	[] as PendingImage[],
) as PendingImage[];

/**
 * Turn a composer draft into SDK content blocks: images first, then the
 * trimmed text, matching the SDK's expected block order.
 *
 * Returns an empty array for an empty draft — callers guard before sending.
 */
export function buildUserBlocks(
	text: string,
	images: PendingImage[],
): UserContentBlock[] {
	const blocks: UserContentBlock[] = [];
	for (const img of images) {
		blocks.push({
			type: "image",
			source: {
				type: "base64",
				media_type: img.media_type,
				data: img.data,
			},
		});
	}
	if (text.trim()) blocks.push({ type: "text", text: text.trim() });
	return blocks;
}

/**
 * Inverse of `buildUserBlocks` — rebuild a composer draft from stored blocks.
 * Used when pulling a queued message back into the composer, so an image
 * survives the round trip instead of being reduced to its `imageCount`.
 */
export function draftFromBlocks(blocks: UserContentBlock[]): {
	text: string;
	images: PendingImage[];
} {
	let text = "";
	const images: PendingImage[] = [];
	for (const block of blocks) {
		if (block.type === "text") {
			text = text ? `${text}\n${block.text}` : block.text;
		} else if (block.type === "image") {
			images.push({
				media_type: block.source.media_type,
				data: block.source.data,
				previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
			});
		}
	}
	return { text, images };
}
