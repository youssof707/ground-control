import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ClipboardEvent,
	type DragEvent,
} from "react";
import { useDraftStore } from "../stores/useDraftStore";
import type { PendingImage } from "../lib/pendingImage";
import { EMPTY_IMAGES, toSupportedMediaType } from "../lib/composerImages";

/**
 * Pasted-image support for a message composer, backed by the per-session
 * draft store so images survive switching sessions the same way draft text
 * does.
 *
 * Used by `MessageComposer`, the single composer shared by the main chat,
 * drafts, and the sidequest panel.
 *
 * `sessionId` is whatever key the composer drafts under — a real session id, a
 * draft id, or a sidequest id.
 */
export type ComposerDropHandlers = {
	onDragEnter: (e: DragEvent<HTMLElement>) => void;
	onDragOver: (e: DragEvent<HTMLElement>) => void;
	onDragLeave: (e: DragEvent<HTMLElement>) => void;
	onDrop: (e: DragEvent<HTMLElement>) => void;
};

function carriesFiles(e: DragEvent<HTMLElement>): boolean {
	return Array.from(e.dataTransfer.types).includes("Files");
}

export function useComposerImages(
	sessionId: string,
	onError?: (message: string | null) => void,
	acceptDrops = true,
): {
	images: PendingImage[];
	onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
	dragActive: boolean;
	dropHandlers: ComposerDropHandlers;
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

	const addImageFiles = useCallback(
		(files: File[]) => {
			for (const file of files) {
				const mediaType = toSupportedMediaType(file.type);
				if (!mediaType) {
					onErrorRef.current?.(`Unsupported image type: ${file.type}`);
					continue;
				}
				const reader = new FileReader();
				reader.onload = () => {
					const dataUrl = reader.result as string;
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

	const onPaste = useCallback(
		(e: ClipboardEvent<HTMLTextAreaElement>) => {
			const items = Array.from(e.clipboardData.items);
			const imageItems = items.filter((it) => it.type.startsWith("image/"));
			if (imageItems.length === 0) return;
			e.preventDefault();
			addImageFiles(
				imageItems
					.map((item) => item.getAsFile())
					.filter((file): file is File => file !== null),
			);
		},
		[addImageFiles],
	);

	const [dragActive, setDragActive] = useState(false);
	const dragDepth = useRef(0);
	const acceptDropsRef = useRef(acceptDrops);
	useLayoutEffect(() => {
		acceptDropsRef.current = acceptDrops;
	});

	const dropHandlers = useMemo<ComposerDropHandlers>(
		() => ({
			onDragEnter: (e) => {
				if (!carriesFiles(e)) return;
				e.preventDefault();
				dragDepth.current += 1;
				setDragActive(true);
			},
			onDragOver: (e) => {
				if (!carriesFiles(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = acceptDropsRef.current ? "copy" : "none";
			},
			onDragLeave: (e) => {
				if (!carriesFiles(e)) return;
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setDragActive(false);
			},
			onDrop: (e) => {
				if (!carriesFiles(e)) return;
				e.preventDefault();
				dragDepth.current = 0;
				setDragActive(false);
				if (!acceptDropsRef.current) return;
				addImageFiles(
					Array.from(e.dataTransfer.files).filter((file) =>
						file.type.startsWith("image/"),
					),
				);
			},
		}),
		[addImageFiles],
	);

	const removeImage = useCallback(
		(idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx)),
		[setImages],
	);

	return {
		images,
		onPaste,
		dragActive: dragActive && acceptDrops,
		dropHandlers,
		removeImage,
		setImages,
	};
}
