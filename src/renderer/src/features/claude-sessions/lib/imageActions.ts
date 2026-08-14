/**
 * Actions on the two images the renderer shows: pending-paste thumbnails in
 * the composer, and image blocks in the transcript. Both hold nothing but
 * base64 — there is no file on disk — so every action here routes through
 * the main process, which materialises bytes as needed.
 *
 * Both functions take `data` as raw base64 (or a full `data:` URL — the main
 * handler accepts either) and a `mediaType` that may be undefined, since
 * transcript blocks type it loosely. Neither ever rejects: they return null
 * on success or a short user-facing string on failure, so callers with an
 * error slot can render it and callers without one can ignore the result.
 * The underlying error is always logged here.
 *
 * See src/main/ipc/imageHandlers.ts for the validation + normalisation.
 */

/**
 * Ask the main process to write a temp copy and open it in macOS Preview.
 */
export async function openImageInPreview(
	mediaType: string | undefined,
	data: string,
): Promise<string | null> {
	try {
		await window.claude.openImageInPreview({ mediaType, data });
		return null;
	} catch (err) {
		// Electron wraps handler errors as "Error invoking remote method
		// 'shell:openImage': …", which is noise in a UI. Log the real thing,
		// show one plain line.
		console.error("Failed to open image in Preview", err);
		return "Could not open this image in Preview.";
	}
}

/**
 * Formats Electron's `nativeImage.createFromBuffer` can actually decode.
 * Anything else comes back as an empty image, so we re-encode first.
 */
const NATIVE_DECODABLE = new Set(["image/png", "image/jpeg"]);

/**
 * Re-encode an image to PNG using a canvas.
 *
 * Chromium decodes GIF and WebP happily even though Electron's nativeImage
 * cannot, so the renderer is the right place to normalise them. Animated
 * GIFs collapse to their first frame — which is all a clipboard image can
 * be anyway.
 */
function toPngBase64(dataUrl: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const im = new Image();
		im.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = im.naturalWidth;
			canvas.height = im.naturalHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Could not get a 2d canvas context"));
				return;
			}
			ctx.drawImage(im, 0, 0);
			resolve(canvas.toDataURL("image/png").split(",")[1] ?? "");
		};
		im.onerror = () => reject(new Error("Browser could not decode the image"));
		im.src = dataUrl;
	});
}

/**
 * Copy the image to the system clipboard as a real image, so Cmd+V into
 * Preview / Messages / Figma pastes the picture rather than a path.
 */
export async function copyImageToClipboard(
	mediaType: string | undefined,
	data: string,
): Promise<string | null> {
	try {
		let payloadType = mediaType;
		let payloadData = data;
		// GIF/WebP (and anything unrecognised) would decode to an empty
		// nativeImage in main, so hand it PNG bytes instead.
		if (!mediaType || !NATIVE_DECODABLE.has(mediaType)) {
			const dataUrl = data.startsWith("data:")
				? data
				: `data:${mediaType ?? "image/png"};base64,${data}`;
			payloadData = await toPngBase64(dataUrl);
			payloadType = "image/png";
		}
		await window.claude.copyImage({
			mediaType: payloadType,
			data: payloadData,
		});
		return null;
	} catch (err) {
		console.error("Failed to copy image to clipboard", err);
		return "Could not copy this image.";
	}
}
