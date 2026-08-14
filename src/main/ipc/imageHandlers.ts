import { clipboard, ipcMain, nativeImage, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { UserImageMediaType } from "../../shared/schemas/claude_session";

const execFileAsync = promisify(execFile);

/**
 * Opening an in-memory image in a native app.
 *
 * Both places the renderer shows an image (pending paste thumbnails in the
 * composer, and image blocks in the transcript) hold nothing but base64 —
 * there is no file on disk at any point, and persisted history keeps the
 * base64 inline in the store JSON. So "open this full-size" necessarily
 * means: materialise a temp copy, then hand its path to Preview.
 */

/** One flat dir inside the OS temp dir. Created lazily on first open. */
const IMAGE_TMP_DIR = join(tmpdir(), "ground-control-images");

/**
 * Extension per supported media type. Keyed by the closed union from the Zod
 * schema, so adding a member there is a compile error here until someone
 * picks an extension for it — that coupling is deliberate.
 */
const EXT_BY_MEDIA_TYPE: Record<UserImageMediaType, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
};

/** ~24 MiB decoded. Anything larger is not a pasted screenshot. */
const MAX_BASE64_CHARS = 32 * 1024 * 1024;

interface NormalizedImage {
	base64: string;
	mediaType: UserImageMediaType;
}

/**
 * Validate + normalise an untrusted renderer payload.
 *
 * Accepts `data` as EITHER raw base64 (what the composer keeps for the SDK,
 * and what transcript blocks carry) OR a full `data:<type>;base64,…` URL
 * (what the composer keeps for the `<img src>`), so neither callsite has to
 * pre-process. When a data-URL prefix is present its media type wins over
 * the caller's, since it came from the same FileReader that produced the
 * bytes.
 *
 * Throws on anything unusable — ipcMain.handle turns that into a rejected
 * invoke() promise, which the renderer helper catches.
 */
function normalizeImagePayload(payload: unknown): NormalizedImage {
	if (typeof payload !== "object" || payload === null) {
		throw new Error("Invalid image payload");
	}
	const { mediaType, data } = payload as {
		mediaType?: unknown;
		data?: unknown;
	};
	if (typeof data !== "string" || data.length === 0) {
		throw new Error("Invalid image payload");
	}

	let body = data;
	let sniffed: string | undefined;
	if (body.startsWith("data:")) {
		const comma = body.indexOf(",");
		if (comma === -1) throw new Error("Malformed data URL");
		// "data:image/png;base64" -> "image/png"
		sniffed = body.slice(5, comma).split(";")[0] || undefined;
		body = body.slice(comma + 1);
	}
	// FileReader never wraps its output, but be tolerant of base64 that
	// arrived with newlines from anywhere else.
	body = body.replace(/\s+/g, "");

	if (body.length === 0) throw new Error("Image data is empty");
	if (body.length > MAX_BASE64_CHARS) {
		throw new Error("Image is too large to open");
	}
	// Reject non-base64 before writing: Buffer.from(…, "base64") silently
	// drops invalid characters, which would produce a corrupt file that
	// Preview opens as a blank window rather than an error.
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
		throw new Error("Image data is not base64");
	}

	// Transcript blocks type media_type as a loose `string | undefined`, so
	// an unknown value is expected rather than exceptional: default to png
	// instead of failing. Worst case the extension is wrong and Preview
	// sniffs the real format from the file's magic bytes.
	const candidate = sniffed ?? mediaType;
	const mediaTypeResolved: UserImageMediaType =
		typeof candidate === "string"
		&& Object.hasOwn(EXT_BY_MEDIA_TYPE, candidate)
			? (candidate as UserImageMediaType)
			: "image/png";

	return { base64: body, mediaType: mediaTypeResolved };
}

/**
 * Write (or reuse) the temp copy and return its absolute path.
 *
 * The filename is a content hash, which buys two things: double-clicking the
 * same thumbnail twenty times reuses one file instead of littering temp, and
 * two different images can never collide on a name while Preview holds one
 * of them open. It also means the composer thumbnail and the same image in
 * the transcript resolve to one file, since the base64 is byte-identical.
 *
 * No cleanup hook by design: this is the OS temp dir (macOS prunes it), the
 * hash naming bounds growth to one file per distinct image, and deleting on
 * quit would break any Preview window the user still has open — Preview
 * keeps the path, not the bytes.
 */
async function writeTempImage(img: NormalizedImage): Promise<string> {
	const hash = createHash("sha256")
		.update(img.base64)
		.digest("hex")
		.slice(0, 16);
	const path = join(
		IMAGE_TMP_DIR,
		`${hash}.${EXT_BY_MEDIA_TYPE[img.mediaType]}`,
	);
	await fs.mkdir(IMAGE_TMP_DIR, { recursive: true });
	// Materialised by an earlier open — skip the (potentially multi-MB)
	// rewrite. Any stat failure just means "write it".
	try {
		const stat = await fs.stat(path);
		if (stat.isFile() && stat.size > 0) return path;
	} catch {
		// Not there / unreadable — fall through to the write.
	}
	await fs.writeFile(path, Buffer.from(img.base64, "base64"));
	return path;
}

/**
 * Open `path` in Preview specifically.
 *
 * `open -a Preview` pins the app rather than deferring to whatever currently
 * owns .png on this machine (VS Code, Photoshop, a browser). Shell-free
 * execFile, same style as the git helpers in ../sessions/git.ts.
 *
 * Fallback: `open` exits non-zero if Preview can't be launched — removed,
 * relocated, or we're not on macOS at all. In that case fall back to
 * shell.openPath, which uses the user's default handler. That's strictly
 * better than an error, since the goal was "see it big", not "see it in
 * Preview". openPath resolves to "" on success and to a message on failure,
 * so a non-empty return is a real error worth surfacing.
 */
async function openInPreview(path: string): Promise<void> {
	try {
		await execFileAsync("open", ["-a", "Preview", path]);
		return;
	} catch (err) {
		console.error("`open -a Preview` failed, falling back:", err);
	}
	const message = await shell.openPath(path);
	if (message) throw new Error(message);
}

export function registerImageHandlers(): void {
	ipcMain.handle("shell:openImage", async (_e, payload: unknown) => {
		const img = normalizeImagePayload(payload);
		const path = await writeTempImage(img);
		await openInPreview(path);
	});

	/**
	 * Put the image on the system clipboard as a real image (not a path or a
	 * base64 string), so Cmd+V into Preview / Messages / Figma pastes the
	 * picture.
	 *
	 * Callers must hand us PNG or JPEG. `nativeImage.createFromBuffer` decodes
	 * only those two — GIF and WebP come back as an empty image, which
	 * `clipboard.writeImage` would then silently write as nothing. The
	 * renderer re-encodes anything else to PNG on a canvas before calling
	 * this (see lib/imageActions.ts), and the isEmpty() guard below is
	 * the backstop so a decode failure surfaces as an error instead of a
	 * mysteriously unchanged clipboard.
	 */
	ipcMain.handle("shell:copyImage", async (_e, payload: unknown) => {
		const img = normalizeImagePayload(payload);
		const native = nativeImage.createFromBuffer(
			Buffer.from(img.base64, "base64"),
		);
		if (native.isEmpty()) {
			throw new Error(`Could not decode ${img.mediaType} for the clipboard`);
		}
		clipboard.writeImage(native);
	});
}
