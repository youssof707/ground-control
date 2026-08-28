import { useCallback, useLayoutEffect, useRef, type ClipboardEvent } from "react";
import { useDraftStore } from "../stores/useDraftStore";
import type { PendingImage } from "../lib/pendingImage";
import { EMPTY_IMAGES, toSupportedMediaType } from "../lib/composerImages";

/**
 * Pasted-image support for a message composer, backed by the per-session
 * draft store so images survive switching sessions the same way draft text
 * does.
 *
 * Shared by `ImagePasteTextarea` (main chat + draft screen) and the sidequest
 * panel's `SidequestComposer`.
 *
 * `sessionId` is whatever key the composer drafts under — a real session id, a
 * draft id, or a sidequest id.
 */
export function useComposerImages(
	sessionId: string,
	onError?: (message: string | null) => void,
): {
	images: PendingImage[];
	onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
	removeImage: (idx: number) => void;
	setImages: (
		next: PendingImage[] | ((prev: PendingImage[]) => PendingImage[]),
	) => void;
} {
	const images = useDraftStore(
		(s) => s.draftsBySession[sessionId]?.images ?? EMPTY_IMAGES,
	);

	// Held in a ref so `onPaste` stays referentially stable across renders even
	// when the caller passes an inline arrow.
	const onErrorRef = useRef(onError);
	useLayoutEffect(() => {
		onErrorRef.current = onError;
	});

	// Always reads the *current* store value rather than the subscribed
	// `images` above: FileReader.onload callbacks are async, so a multi-image
	// paste fires several of these in the same tick and a stale closure would
	// drop all but the last.
	const setImages = useCallback(
		(next: PendingImage[] | ((prev: PendingImage[]) => PendingImage[])) => {
			const current =
				useDraftStore.getState().draftsBySession[sessionId]?.images ?? [];
			const value = typeof next === "function" ? next(current) : next;
			useDraftStore.getState().setDraftImages(sessionId, value);
		},
		[sessionId],
	);

	const onPaste = useCallback(
		(e: ClipboardEvent<HTMLTextAreaElement>) => {
			const items = Array.from(e.clipboardData.items);
			const imageItems = items.filter((it) => it.type.startsWith("image/"));
			// No images in the payload — let the browser handle it as a normal
			// text paste.
			if (imageItems.length === 0) return;
			e.preventDefault();
			for (const item of imageItems) {
				const file = item.getAsFile();
				if (!file) continue;
				const mediaType = toSupportedMediaType(file.type);
				if (!mediaType) {
					onErrorRef.current?.(`Unsupported image type: ${file.type}`);
					continue;
				}
				const reader = new FileReader();
				reader.onload = () => {
					const dataUrl = reader.result as string;
					// Strip the "data:<type>;base64," prefix — the SDK wants raw
					// base64, while the data URL doubles as the <img> preview src.
					const data = dataUrl.split(",")[1] ?? "";
					setImages((prev) => [
						...prev,
						{ media_type: mediaType, data, previewUrl: dataUrl },
					]);
				};
				reader.readAsDataURL(file);
			}
		},
		[setImages],
	);

	const removeImage = useCallback(
		(idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx)),
		[setImages],
	);

	return { images, onPaste, removeImage, setImages };
}
